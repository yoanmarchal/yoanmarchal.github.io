import vertexShader from "../shaders/quad.vert.glsl";
import fragmentShader from "../shaders/textWarp.frag.glsl";
import persistShader from "../shaders/persist.frag.glsl";
import { MAX_PIXEL_RATIO, createQuadProgram, createRenderTarget, getWebGLContext, loseContext, sizeCanvas } from "./gl.js";

const STRENGTH = 0.12;

// Phosphor tint applied by the shader to neutral (white/grey) text until
// main.js passes the current theme's (see src/ui/theme.js) - a slightly
// cool white, like a P4 monochrome tube. Saturated colors keep their hue.
const PHOSPHOR = [0.93, 0.97, 1.0];

// Set on the source element while the warped stand-in is on screen - the
// CSS hides the real glyphs only under it, so removing it (WebGL lost or
// unsupported) instantly brings the plain DOM text back.
const ACTIVE_CLASS = "crt-warp-active";

// Keeps drawing for a few frames after the last invalidation - a safety
// net for a layout change that lands a frame after the mutation causing it.
const RENDER_TAIL_MS = 50;

// Phosphor persistence: the glow a pixel leaves fades with this time
// constant once the beam stops lighting it - and the loop keeps drawing
// (shader passes only, no DOM re-measuring) until it's gone.
const PERSIST_TAU_MS = 70;
const PERSIST_TAIL_MS = 260;

// After a change, the DOM is re-measured and re-uploaded for this many
// frames (the change itself, plus one for a layout landing a frame late) -
// the rest of the tail only runs the shader passes.
const MIRROR_FRAMES = 2;

// Live graphics (see addLiveGraphic) animate at this rate - a full frame
// runs every CRT pass, so there's no need for the display's 60-120Hz.
const GRAPHIC_FRAME_MS = 33;

// While the content scrolls, persistence is off: every line moving at once
// would smear into the next one and the text would blur. Back on this long
// after the last scroll event.
const SCROLL_SETTLE_MS = 150;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// A transition whose end event never arrives (e.g. its element was removed
// mid-flight) must not keep the render loop alive forever.
const TRANSITION_TIMEOUT_MS = 3000;

const MAX_CONTEXT_RECOVERIES = 3;

// Hit-box offsets that move by less than this (CSS px) aren't rewritten -
// see _alignHitBoxes.
const HIT_OFFSET_EPSILON = 0.25;

// Section change: the panel loses sync, then the new one prints in
const GLITCH_MS = 340;
// Theme change: the degauss wobble
const DEGAUSS_MS = 800;

// Mirrors the fragment shader's displacement math: for an output pixel at
// (centerX, centerY), the shader samples the source texture at
// `uv + centered * r2 * strength`. Used to keep the real, invisible,
// interactive elements (nav links, buttons) positioned under their own warped
// visual text, so hover/click land where the text actually appears.
function computeWarpOffsetPx(centerX, centerY, originWidth, originHeight, strength) {
  const cx = centerX / originWidth - 0.5;
  const cy = centerY / originHeight - 0.5;
  const r2 = cx * cx + cy * cy;
  return {
    dx: cx * r2 * strength * originWidth,
    dy: cy * r2 * strength * originHeight,
  };
}

function collectLeaves(root) {
  const result = [];
  (function walk(node) {
    if (node.classList?.contains("reveal-pending")) return;
    // screen-reader-only copies of scrambled text - never visible
    if (node.classList?.contains("sr-only")) return;
    if (node.tagName === "IMG") {
      result.push(node);
      return;
    }
    const children = [...node.children];
    if (children.length === 0) {
      if (node.textContent.trim().length > 0) result.push(node);
      return;
    }
    children.forEach(walk);
  })(root);
  return result;
}

function drawBorder(ctx, style, left, top, width, height) {
  const sides = [
    ["Top", left, top, left + width, top],
    ["Right", left + width, top, left + width, top + height],
    ["Bottom", left, top + height, left + width, top + height],
    ["Left", left, top, left, top + height],
  ];

  for (const [name, x1, y1, x2, y2] of sides) {
    const borderWidth = parseFloat(style[`border${name}Width`]);
    const borderStyle = style[`border${name}Style`];
    if (!borderWidth || borderStyle === "none") continue;

    ctx.save();
    ctx.strokeStyle = style[`border${name}Color`];
    ctx.lineWidth = borderWidth;
    ctx.setLineDash(borderStyle === "dashed" ? [borderWidth * 3, borderWidth * 2] : []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
}

// Splits a wrapped leaf's text into the line boxes the browser actually
// laid out, by measuring each character with a Range - so the mirror breaks
// lines exactly where the invisible DOM text does (including CSS rules like
// overflow-wrap: anywhere) instead of re-guessing the wrap on the canvas.
function measureTextLines(el) {
  const lines = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let current = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.data;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      // collapsed whitespace (e.g. the space swallowed at a line break)
      if (r.width === 0 && r.height === 0) continue;

      if (!current || Math.abs(r.top - current.top) > r.height / 2) {
        current = { text: "", left: r.left, top: r.top, bottom: r.bottom };
        lines.push(current);
      }
      current.text += text[i];
      current.bottom = Math.max(current.bottom, r.bottom);
    }
  }

  return lines;
}

/**
 * Mirrors the currently-visible text inside `sourceEl` onto an offscreen
 * 2D canvas, then renders that canvas as a WebGL texture through a
 * barrel-distortion fragment shader onto `canvas`.
 *
 * The real DOM text stays in place underneath (still focusable, readable
 * by screen readers) - CSS makes its glyphs invisible via
 * -webkit-text-fill-color so only this warped copy shows.
 *
 * Renders on demand: a frame is drawn only when something that can change
 * the picture happens inside `sourceEl` (DOM mutation, CSS transition,
 * scroll, focus, resize, image/font load), so an idle screen costs nothing.
 */
export class TextWarpLayer {
  constructor(canvas, sourceEl) {
    this.canvas = canvas;
    this.sourceEl = sourceEl;
    this.supported = false;
    this._width = 0;
    this._height = 0;
    this._strength = STRENGTH;
    this._phosphor = PHOSPHOR;

    this.mirror = document.createElement("canvas");
    this.mirrorCtx = this.mirror.getContext("2d");
    this._hitOffsets = new WeakMap();
    this._runningTransitions = new Map();
    // timed shader effects (glitch, degauss) - keyed by their uniform
    this._effects = new Map();
    this._glitchRegion = null;
    this._renderUntil = 0;
    this._mirrorFrames = 0;
    // until then every frame redraws the whole screen (persistence fading
    // after a change); past it, a frame that only animates a live graphic
    // redraws just that graphic's region
    this._fullUntil = 0;
    this._forceMirror = true;
    this._lastRenderAt = 0;
    this._lastCompositeAt = 0;
    // animated drawings mixed into the picture (addLiveGraphic)
    this._graphics = [];
    this._graphicsActive = false;
    this._rafId = 0;
    this._contextRecoveries = 0;

    this._tick = this._tick.bind(this);
    this.invalidate = this.invalidate.bind(this);
    this._onTransitionRun = this._onTransitionRun.bind(this);
    this._onTransitionStop = this._onTransitionStop.bind(this);
    this._onWindowResize = this._onWindowResize.bind(this);
    this._onScroll = this._onScroll.bind(this);
    this._scrollUntil = 0;

    if (!this._setupGL()) return;

    this.supported = true;
    this._running = true;
    this.sourceEl.classList.add(ACTIVE_CLASS);
    this._observe();
    this.invalidate();
  }

  _setupGL() {
    const gl = getWebGLContext(this.canvas);
    if (!gl) return false;

    let quad;
    try {
      quad = createQuadProgram(gl, vertexShader, fragmentShader);
    } catch {
      return false;
    }

    // trails (persistence) are motion - skipped under reduced motion,
    // which then draws straight to the screen as before
    let persist = null;
    if (!prefersReducedMotion()) {
      try {
        persist = createQuadProgram(gl, vertexShader, persistShader);
      } catch {
        persist = null;
      }
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 2D canvas rows run top-down, GL texture rows bottom-up; and the
    // premultiplied upload matches the context's premultipliedAlpha
    // compositing, so the shader can output the sample unchanged
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    quad.use();
    gl.uniform1i(quad.uniform("uTexture"), 0);
    gl.uniform1f(quad.uniform("uStrength"), this._strength);
    gl.uniform3fv(quad.uniform("uPhosphor"), this._phosphor);

    // Mobile browsers routinely drop WebGL contexts (backgrounded tab, GPU
    // reset). Without handling it the real text would stay invisible over
    // a blank canvas - an empty screen.
    const canvas = this.canvas;
    canvas.addEventListener(
      "webglcontextlost",
      () => {
        if (canvas === this.canvas) this._onContextLost();
      },
      { once: true }
    );

    this.gl = gl;
    this.quad = quad;
    this.texture = texture;
    this.persist = persist;
    // the CRT pass renders here, then two history buffers ping-pong the
    // persistence (one is last frame's glow, the other receives this one's)
    this._targets = persist
      ? { crt: createRenderTarget(gl), history: [createRenderTarget(gl), createRenderTarget(gl)] }
      : null;
    this._historyIndex = 0;
    this._forceMirror = true;

    if (this._width && this._height) {
      sizeCanvas(this.canvas, this._width, this._height);
      quad.use();
      gl.uniform2f(quad.uniform("uResolution"), this._width, this._height);
      this._sizeTargets();
    }
    return true;
  }

  _observe() {
    const el = this.sourceEl;

    this._mutationObserver = new MutationObserver(this.invalidate);
    this._mutationObserver.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    this._resizeObserver = new ResizeObserver(this.invalidate);
    this._resizeObserver.observe(el);

    el.addEventListener("scroll", this._onScroll, { capture: true, passive: true });
    el.addEventListener("focusin", this.invalidate);
    el.addEventListener("focusout", this.invalidate);
    // `load` doesn't bubble - capture catches <img> loads inside
    el.addEventListener("load", this.invalidate, true);
    el.addEventListener("transitionrun", this._onTransitionRun);
    el.addEventListener("transitionend", this._onTransitionStop);
    el.addEventListener("transitioncancel", this._onTransitionStop);
    document.fonts?.addEventListener("loadingdone", this.invalidate);

    // Chromium (seen in both headless and windowed Chrome) can leave a
    // stale, ghosted frame composited on this canvas after a resize -
    // reproducibly, regardless of extra draws, canvas-size nudges or
    // display:none/reflow toggles. Only a full context teardown + rebuild
    // has been found to clear it. Debounced so a dragged window edge
    // doesn't pay that cost on every intermediate frame.
    window.addEventListener("resize", this._onWindowResize);
  }

  _onScroll() {
    this._scrollUntil = performance.now() + SCROLL_SETTLE_MS;
    this.invalidate();
  }

  _onTransitionRun(event) {
    this._runningTransitions.set(event.target, performance.now());
    this.invalidate();
  }

  _onTransitionStop(event) {
    this._runningTransitions.delete(event.target);
    this.invalidate();
  }

  invalidate() {
    if (!this._running) return;
    const now = performance.now();
    this._mirrorFrames = MIRROR_FRAMES;
    const tail = now + (this.persist ? PERSIST_TAIL_MS : RENDER_TAIL_MS);
    this._renderUntil = Math.max(this._renderUntil, tail);
    this._fullUntil = Math.max(this._fullUntil, tail);
    if (!this._rafId) this._rafId = requestAnimationFrame(this._tick);
  }

  _hasRunningTransitions(now) {
    for (const [el, startedAt] of this._runningTransitions) {
      if (!el.isConnected || now - startedAt > TRANSITION_TIMEOUT_MS) {
        this._runningTransitions.delete(el);
      }
    }
    return this._runningTransitions.size > 0;
  }

  _tick() {
    this._rafId = 0;
    if (!this._running) return;

    const now = performance.now();
    const busy = now < this._renderUntil || this._hasRunningTransitions(now) || this._effects.size > 0;
    const animating = this._graphicsActive && !prefersReducedMotion();
    // a live graphic alone only needs its own (lower) frame rate
    if (busy || !animating || now - this._lastRenderAt >= GRAPHIC_FRAME_MS) {
      this._lastRenderAt = now;
      this._render(now);
    }

    if (busy || animating) this._rafId = requestAnimationFrame(this._tick);
  }

  _render(now = performance.now()) {
    const { gl } = this;
    if (gl.isContextLost()) return;

    const rect = this.sourceEl.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    if (width !== this._width || height !== this._height) this._resize(width, height);

    // before the mirror is drawn: a glitch's midpoint swaps the DOM, which
    // this same frame then shows (dimmed, at the glitch's peak)
    this._updateEffects(now, rect);

    const graphics = this._measureGraphics(rect);

    // The DOM is only re-measured and re-uploaded when something may have
    // changed it - frames that only animate a live graphic or fade the
    // persistence reuse the texture as it is.
    const needMirror =
      this._forceMirror ||
      graphics.someHidden ||
      this._mirrorFrames > 0 ||
      this._runningTransitions.size > 0 ||
      this._effects.size > 0;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (needMirror) {
      this._forceMirror = false;
      this._mirrorFrames = Math.max(this._mirrorFrames - 1, 0);
      this._drawMirror(rect);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.mirror);
    }
    this._drawGraphics(graphics.visible, now);

    // nothing but the live graphics changing: only their region (plus a
    // margin for the warp's displacement and the glow) needs the CRT passes
    const partial = !needMirror && now >= this._fullUntil && graphics.visible.length > 0;
    this._composite(now, partial ? this._graphicsRegion(graphics.visible) : null);
  }

  // the visible graphics' bounding box in GL framebuffer pixels (origin
  // bottom-left), widened by the most the warp can shift a pixel (~3% of the
  // screen at the corners) and the glow's reach
  _graphicsRegion(visible) {
    const dpr = this.canvas.width / this._width;
    const margin = Math.max(this.canvas.width, this.canvas.height) * 0.04 + 12 * dpr;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const box of visible) {
      left = Math.min(left, box.left);
      top = Math.min(top, box.top);
      right = Math.max(right, box.left + box.width);
      bottom = Math.max(bottom, box.top + box.height);
    }
    const x0 = Math.max(Math.floor(left * dpr - margin), 0);
    const x1 = Math.min(Math.ceil(right * dpr + margin), this.canvas.width);
    const y0 = Math.max(Math.floor(top * dpr - margin), 0);
    const y1 = Math.min(Math.ceil(bottom * dpr + margin), this.canvas.height);
    return { x: x0, y: this.canvas.height - y1, width: x1 - x0, height: y1 - y0 };
  }

  // CRT pass, then (with persistence) blend it over what's left of the
  // previous frame's glow and put that on screen.
  // `region` (GL pixels) limits every pass to that box - the rest of the
  // screen, and of the persistence buffers, keeps what it had.
  _composite(now, region = null) {
    const { gl, quad, persist, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    if (region) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(region.x, region.y, region.width, region.height);
    }
    try {
      this._compositePasses(now, w, h);
    } finally {
      if (region) gl.disable(gl.SCISSOR_TEST);
    }
  }

  _compositePasses(now, w, h) {
    const { gl, quad, persist } = this;

    if (!persist || !this._targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      quad.draw();
      return;
    }

    const dt = now - this._lastCompositeAt;
    this._lastCompositeAt = now;
    const decay = dt >= 0 && dt < 1000 && now >= this._scrollUntil ? Math.exp(-dt / PERSIST_TAU_MS) : 0;

    const { crt, history } = this._targets;
    const previous = history[this._historyIndex];
    const next = history[1 - this._historyIndex];

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, crt.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    quad.draw();

    persist.use();
    gl.uniform1i(persist.uniform("uCurrent"), 1);
    gl.uniform1i(persist.uniform("uPrevious"), 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, crt.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, previous.texture);
    gl.uniform1f(persist.uniform("uDecay"), decay);
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer);
    persist.draw();

    // copy to the screen: the same program with nothing carried over
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, next.texture);
    gl.uniform1i(persist.uniform("uPrevious"), 1);
    gl.uniform1f(persist.uniform("uDecay"), 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    persist.draw();

    this._historyIndex = 1 - this._historyIndex;
    gl.activeTexture(gl.TEXTURE0);
    quad.use();
  }

  _sizeTargets() {
    if (!this._targets) return;
    const { width, height } = this.canvas;
    this._targets.crt.resize(width, height);
    this._targets.history.forEach((target) => target.resize(width, height));
  }

  /**
   * Mixes an animated drawing into the picture, so it gets the same
   * curvature, tint, glow and persistence as the text: `draw(ctx, width,
   * height, seconds)` paints it (in CSS px, on a cleared canvas) over `el`'s
   * box - which can sit anywhere over the screen, in or out of the source
   * element. Hidden boxes (display: none) are skipped; under reduced motion
   * it's drawn once per redraw, at `seconds` = 0.
   */
  addLiveGraphic(el, draw) {
    const canvas = document.createElement("canvas");
    this._graphics.push({ el, draw, canvas, ctx: canvas.getContext("2d"), visible: false });
    this.invalidate();
  }

  _measureGraphics(originRect) {
    const visible = [];
    let someHidden = false;
    for (const graphic of this._graphics) {
      const r = graphic.el.getBoundingClientRect();
      const shown = r.width >= 2 && r.height >= 2;
      if (shown) {
        visible.push({ graphic, left: r.left - originRect.left, top: r.top - originRect.top, width: r.width, height: r.height });
      } else if (graphic.visible) {
        // its last frame is still in the texture: a fresh mirror clears it
        someHidden = true;
      }
      graphic.visible = shown;
    }
    this._graphicsActive = visible.length > 0;
    return { visible, someHidden };
  }

  _drawGraphics(visible, now) {
    if (!visible.length) return;
    const { gl } = this;
    const dpr = this.mirror.width / this._width;
    const seconds = prefersReducedMotion() ? 0 : now / 1000;

    for (const { graphic, left, top, width, height } of visible) {
      const x = Math.round(left * dpr);
      const y = Math.round(top * dpr);
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      // texSubImage2D rejects anything reaching outside the texture
      if (x < 0 || y < 0 || x + w > this.mirror.width || y + h > this.mirror.height) continue;

      const { canvas, ctx } = graphic;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      graphic.draw(ctx, width, height, seconds);

      // the texture is uploaded flipped (rows bottom-up), so the box's
      // offset is counted from the bottom
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, this.mirror.height - (y + h), gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    }
  }

  _resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.mirror.width = Math.max(1, Math.round(width * dpr));
    this.mirror.height = Math.max(1, Math.round(height * dpr));
    this.mirrorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeCanvas(this.canvas, width, height);
    this._width = width;
    this._height = height;
    this.quad.use();
    this.gl.uniform2f(this.quad.uniform("uResolution"), width, height);
    this._sizeTargets();
    this._forceMirror = true;
  }

  // Called by initResponsiveCurvature and the dev curvature tuner (see
  // src/dev/curvatureTuner.js). Stored on the instance so it survives
  // _rebuild setting up a new context from scratch.
  setStrength(value) {
    this._strength = value;
    if (!this.supported) return;
    this.quad.use();
    this.gl.uniform1f(this.quad.uniform("uStrength"), value);
    this.invalidate();
  }

  // `rgb` is a [r, g, b] triple in 0..1 - the color neutral text is tinted
  // towards (see textWarp.frag.glsl). Stored like the strength so it
  // survives a context rebuild.
  setPhosphor(rgb) {
    this._phosphor = rgb;
    if (!this.supported) return;
    this.quad.use();
    this.gl.uniform3fv(this.quad.uniform("uPhosphor"), rgb);
    this.invalidate();
  }

  /**
   * Plays the section-change glitch over the part of the screen below
   * `regionEl`'s top (the section, not the hero/nav above it), calling
   * `onMidpoint` at its peak - when the picture is darkest - to swap the
   * content underneath. Resolves once it's over. Without WebGL, just swaps.
   */
  playGlitch(onMidpoint, regionEl) {
    this._glitchRegion = regionEl;
    return this._play("uGlitch", GLITCH_MS, (t) => Math.sin(Math.PI * t) ** 0.6, onMidpoint);
  }

  /** The degauss wobble, for a theme change. */
  playDegauss() {
    return this._play("uDegauss", DEGAUSS_MS, (t) => (1 - t) ** 2);
  }

  _play(uniform, duration, envelope, onMidpoint = null) {
    if (!this.supported) {
      onMidpoint?.();
      return Promise.resolve();
    }
    // a new one of the same kind replaces the running one (finishing it)
    this._finishEffect(uniform);
    return new Promise((resolve) => {
      this._effects.set(uniform, { start: performance.now(), duration, envelope, onMidpoint, resolve });
      this.invalidate();
    });
  }

  _updateEffects(now, rect) {
    if (!this._effects.size) return;
    const { gl, quad } = this;
    quad.use();
    gl.uniform1f(quad.uniform("uTime"), (now % 100000) / 1000);

    for (const [uniform, effect] of this._effects) {
      const t = Math.min((now - effect.start) / effect.duration, 1);
      if (t >= 0.5 && effect.onMidpoint) {
        const onMidpoint = effect.onMidpoint;
        effect.onMidpoint = null;
        onMidpoint();
      }
      gl.uniform1f(quad.uniform(uniform), t < 1 ? effect.envelope(t) : 0);
      if (t >= 1) {
        this._effects.delete(uniform);
        effect.resolve();
      }
    }

    if (this._effects.has("uGlitch")) {
      const top = this._glitchRegion ? this._glitchRegion.getBoundingClientRect().top - rect.top : 0;
      // source uv runs bottom-up (the texture is flipped on upload)
      gl.uniform1f(quad.uniform("uGlitchTop"), 1 - Math.min(Math.max(top / this._height, 0), 1));
    }
  }

  // Ends an effect right away (its swap still happens) - for a replaced
  // effect, and when rendering stops, so nothing awaiting it hangs.
  _finishEffect(uniform) {
    const effect = this._effects.get(uniform);
    if (!effect) return;
    this._effects.delete(uniform);
    effect.onMidpoint?.();
    if (this.supported && this.gl && !this.gl.isContextLost()) {
      this.quad.use();
      this.gl.uniform1f(this.quad.uniform(uniform), 0);
    }
    effect.resolve();
  }

  _finishAllEffects() {
    for (const uniform of [...this._effects.keys()]) this._finishEffect(uniform);
  }

  _onWindowResize() {
    clearTimeout(this._resizeSettleTimer);
    this._resizeSettleTimer = setTimeout(() => {
      if (this._running) this._rebuild();
    }, 150);
  }

  // Swaps in a brand-new <canvas> element with its own context rather than
  // reusing this.canvas - a clone never carries over a WebGL context, so
  // the new one is guaranteed a fresh GPU backing store with no inherited
  // state.
  _rebuild() {
    const staleGl = this.gl;
    const freshCanvas = this.canvas.cloneNode(false);
    this.canvas.replaceWith(freshCanvas);
    this.canvas = freshCanvas;

    const ok = this._setupGL();
    loseContext(staleGl);

    if (!ok) {
      this._fallBackToDomText();
      return;
    }

    this.sourceEl.classList.add(ACTIVE_CLASS);
    this._render();
  }

  _onContextLost() {
    // show the real DOM text right away, then try to come back on a fresh
    // context - giving up for good if the GPU keeps dropping it
    this.sourceEl.classList.remove(ACTIVE_CLASS);
    this._finishAllEffects();
    this._clearHitOffsets();

    if (++this._contextRecoveries > MAX_CONTEXT_RECOVERIES) {
      this._fallBackToDomText();
      return;
    }

    setTimeout(() => {
      if (this._running) this._rebuild();
    }, 0);
  }

  _fallBackToDomText() {
    this.stop();
    this.supported = false;
    this.sourceEl.classList.remove(ACTIVE_CLASS);
    this._clearHitOffsets();
    this.canvas.hidden = true;
  }

  _clearHitOffsets() {
    for (const el of this.sourceEl.querySelectorAll("button, a, input")) {
      el.style.transform = "";
    }
    this._hitOffsets = new WeakMap();
  }

  // Hit-box alignment runs as its own pass over the real interactive
  // elements, keyed by the element itself - not by collectLeaves, whose
  // leaves are per-character <span>s once scrambleReveal has wrapped a
  // link/button's text. All rects are read before any transform is
  // written, and a transform is only written when it actually changed, so
  // this doesn't force a layout per element nor re-trigger the
  // MutationObserver on every frame.
  _alignHitBoxes(originRect) {
    const updates = [];

    for (const interactiveEl of this.sourceEl.querySelectorAll("button, a, input")) {
      const iRect = interactiveEl.getBoundingClientRect();
      if (iRect.width <= 0 || iRect.height <= 0) continue;

      const prevOffset = this._hitOffsets.get(interactiveEl);
      const trueLeft = prevOffset ? iRect.left - prevOffset.dx : iRect.left;
      const trueTop = prevOffset ? iRect.top - prevOffset.dy : iRect.top;

      const centerX = trueLeft - originRect.left + iRect.width / 2;
      const centerY = trueTop - originRect.top + iRect.height / 2;
      const shaderOffset = computeWarpOffsetPx(centerX, centerY, this._width, this._height, this._strength);
      // Kept to sub-pixel noise: the "true" position above is recovered
      // from a box that already carries the previous transform (as the
      // browser applied and snapped it), so the result wobbles by tiny
      // amounts from frame to frame. Rewriting the transform for those
      // would be a style mutation, which invalidates this layer, which
      // re-runs this - a redraw loop that never settles.
      if (prevOffset && Math.abs(-shaderOffset.dx - prevOffset.dx) < HIT_OFFSET_EPSILON && Math.abs(-shaderOffset.dy - prevOffset.dy) < HIT_OFFSET_EPSILON) {
        continue;
      }
      // stored exactly as applied, so the next frame subtracts what's
      // really on the element
      const round = (value) => Math.round(value * 100) / 100;
      updates.push([interactiveEl, { dx: round(-shaderOffset.dx), dy: round(-shaderOffset.dy) }]);
    }

    for (const [el, offset] of updates) {
      this._hitOffsets.set(el, offset);
      const transform = `translate(${offset.dx}px, ${offset.dy}px)`;
      if (el.style.transform !== transform) el.style.transform = transform;
    }
  }

  // Opacity isn't inherited, so a leaf's own computed opacity misses any
  // dimmed ancestor (e.g. a .meta line whose text scrambleReveal split into
  // per-character spans) - multiply up the chain to what's really on screen.
  _ancestorOpacity(el, cache) {
    if (!el || el === this.sourceEl) return 1;
    if (cache.has(el)) return cache.get(el);
    const value = parseFloat(getComputedStyle(el).opacity) * this._ancestorOpacity(el.parentElement, cache);
    cache.set(el, value);
    return value;
  }

  _drawMirror(originRect) {
    const ctx = this.mirrorCtx;
    ctx.clearRect(0, 0, this._width, this._height);
    ctx.textBaseline = "middle";

    this._alignHitBoxes(originRect);

    const opacityCache = new Map();
    const underlinedThisFrame = new Set();
    // the focused element's "white-hot" color - set per phosphor theme
    const hot = getComputedStyle(this.sourceEl).getPropertyValue("--hot").trim() || "#ffffff";

    // Borders are normally drawn per leaf (below), but once scrambleReveal
    // has split an element's text into per-character spans that element
    // is no longer a leaf - opted-in containers get theirs drawn here.
    for (const el of this.sourceEl.querySelectorAll("[data-warp-border]")) {
      if (el.children.length === 0 || el.closest(".reveal-pending")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = getComputedStyle(el);
      ctx.globalAlpha = parseFloat(style.opacity) * this._ancestorOpacity(el.parentElement, opacityCache);
      drawBorder(ctx, style, rect.left - originRect.left, rect.top - originRect.top, rect.width, rect.height);
    }

    for (const el of collectLeaves(this.sourceEl)) {
      let rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      // `el` may itself be a link/button, or (once scrambleReveal has
      // wrapped its text) one of its per-character descendant spans -
      // closest() finds the real interactive element either way.
      const interactiveAncestor = el.closest("a, button");

      // rect includes the hit-alignment transform applied above (directly,
      // or inherited from that ancestor) - subtract it back out so drawing
      // uses the element's true, untransformed position.
      const hitOffset = interactiveAncestor ? this._hitOffsets.get(interactiveAncestor) : null;
      const shiftX = hitOffset ? hitOffset.dx : 0;
      const shiftY = hitOffset ? hitOffset.dy : 0;
      if (hitOffset) {
        rect = new DOMRect(rect.x - shiftX, rect.y - shiftY, rect.width, rect.height);
      }

      const style = getComputedStyle(el);
      const opacity = parseFloat(style.opacity) * this._ancestorOpacity(el.parentElement, opacityCache);
      if (!opacity) continue;

      // drawn into the mirror (not as a real CSS outline/shadow on `el`)
      // so it gets warped by the shader in lockstep with the text instead
      // of sitting at a rigid position that drifts from the curved glyphs.
      const isFocused =
        interactiveAncestor !== null &&
        interactiveAncestor === document.activeElement &&
        interactiveAncestor.matches(":focus-visible");

      const localLeft = rect.left - originRect.left;
      const localTop = rect.top - originRect.top;

      ctx.globalAlpha = opacity;
      drawBorder(ctx, style, localLeft, localTop, rect.width, rect.height);

      if (el.tagName === "IMG") {
        // drawImage copies raw source pixels - it ignores the element's
        // own CSS filter (e.g. the logo's grayscale/invert), so that has
        // to be re-applied on the canvas context to match.
        ctx.filter = style.filter === "none" ? "none" : style.filter;
        ctx.drawImage(el, localLeft, localTop, rect.width, rect.height);
        ctx.filter = "none";
        continue;
      }

      const fontSize = parseFloat(style.fontSize);
      let lineHeight = parseFloat(style.lineHeight);
      if (!Number.isFinite(lineHeight)) lineHeight = fontSize * 1.2;

      ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
      ctx.fillStyle = isFocused ? hot : style.color;
      if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing;
      if (isFocused) {
        ctx.shadowColor = hot;
        ctx.shadowBlur = 6;
      }

      const isWrapped = rect.height > lineHeight * 1.4;
      if (isWrapped) {
        ctx.textAlign = "left";
        for (const line of measureTextLines(el)) {
          ctx.fillText(
            line.text,
            line.left - shiftX - originRect.left,
            (line.top + line.bottom) / 2 - shiftY - originRect.top
          );
        }
      } else {
        const align = style.textAlign === "center" || style.textAlign === "right" ? style.textAlign : "left";
        ctx.textAlign = align;
        const x = localLeft + (align === "left" ? 0 : align === "right" ? rect.width : rect.width / 2);
        ctx.fillText(el.textContent, x, localTop + rect.height / 2);
      }

      ctx.shadowBlur = 0;

      // drawn once per link/button (not once per leaf - a scrambled link
      // has one leaf per character) and sized from the ancestor's own
      // rect, so a multi-character label gets a single underline spanning
      // its full width instead of one sliver per glyph.
      if (isFocused && !underlinedThisFrame.has(interactiveAncestor)) {
        underlinedThisFrame.add(interactiveAncestor);
        const aRect = interactiveAncestor.getBoundingClientRect();
        const aLeft = aRect.left - shiftX - originRect.left;
        const underlineY = aRect.top - shiftY - originRect.top + aRect.height + 2;
        ctx.strokeStyle = hot;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(aLeft, underlineY);
        ctx.lineTo(aLeft + aRect.width, underlineY);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  stop() {
    this._running = false;
    this._finishAllEffects();
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    clearTimeout(this._resizeSettleTimer);
    this._mutationObserver?.disconnect();
    this._resizeObserver?.disconnect();

    const el = this.sourceEl;
    el.removeEventListener("scroll", this._onScroll, { capture: true });
    el.removeEventListener("focusin", this.invalidate);
    el.removeEventListener("focusout", this.invalidate);
    el.removeEventListener("load", this.invalidate, true);
    el.removeEventListener("transitionrun", this._onTransitionRun);
    el.removeEventListener("transitionend", this._onTransitionStop);
    el.removeEventListener("transitioncancel", this._onTransitionStop);
    document.fonts?.removeEventListener("loadingdone", this.invalidate);
    window.removeEventListener("resize", this._onWindowResize);
  }
}
