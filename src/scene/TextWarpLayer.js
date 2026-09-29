import vertexShader from "../shaders/quad.vert.glsl";
import fragmentShader from "../shaders/textWarp.frag.glsl";
import { MAX_PIXEL_RATIO, createQuadProgram, getWebGLContext, loseContext, sizeCanvas } from "./gl.js";

const STRENGTH = 0.12;

// Set on the source element while the warped stand-in is on screen - the
// CSS hides the real glyphs only under it, so removing it (WebGL lost or
// unsupported) instantly brings the plain DOM text back.
const ACTIVE_CLASS = "crt-warp-active";

// Keeps drawing for a few frames after the last invalidation - a safety
// net for a layout change that lands a frame after the mutation causing it.
const RENDER_TAIL_MS = 50;

// A transition whose end event never arrives (e.g. its element was removed
// mid-flight) must not keep the render loop alive forever.
const TRANSITION_TIMEOUT_MS = 3000;

const MAX_CONTEXT_RECOVERIES = 3;

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

    this.mirror = document.createElement("canvas");
    this.mirrorCtx = this.mirror.getContext("2d");
    this._hitOffsets = new WeakMap();
    this._runningTransitions = new Map();
    this._renderUntil = 0;
    this._rafId = 0;
    this._contextRecoveries = 0;

    this._tick = this._tick.bind(this);
    this.invalidate = this.invalidate.bind(this);
    this._onTransitionRun = this._onTransitionRun.bind(this);
    this._onTransitionStop = this._onTransitionStop.bind(this);
    this._onWindowResize = this._onWindowResize.bind(this);

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
    gl.uniform1f(quad.uniform("uStrength"), STRENGTH);

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

    if (this._width && this._height) sizeCanvas(this.canvas, this._width, this._height);
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

    el.addEventListener("scroll", this.invalidate, { capture: true, passive: true });
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
    this._renderUntil = performance.now() + RENDER_TAIL_MS;
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

  _tick(now) {
    this._rafId = 0;
    if (!this._running) return;

    this._render();

    if (now < this._renderUntil || this._hasRunningTransitions(now)) {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  _render() {
    const { gl } = this;
    if (gl.isContextLost()) return;

    const rect = this.sourceEl.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    if (width !== this._width || height !== this._height) this._resize(width, height);

    this._drawMirror(rect);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.mirror);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.quad.draw();
  }

  _resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.mirror.width = Math.max(1, Math.round(width * dpr));
    this.mirror.height = Math.max(1, Math.round(height * dpr));
    this.mirrorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeCanvas(this.canvas, width, height);
    this._width = width;
    this._height = height;
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
      const shaderOffset = computeWarpOffsetPx(centerX, centerY, this._width, this._height, STRENGTH);
      updates.push([interactiveEl, { dx: -shaderOffset.dx, dy: -shaderOffset.dy }]);
    }

    for (const [el, offset] of updates) {
      this._hitOffsets.set(el, offset);
      const transform = `translate(${offset.dx.toFixed(2)}px, ${offset.dy.toFixed(2)}px)`;
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
      ctx.fillStyle = isFocused ? "#ffffff" : style.color;
      if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing;
      if (isFocused) {
        ctx.shadowColor = "rgba(242, 242, 242, 0.9)";
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
        ctx.strokeStyle = "#ffffff";
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
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    clearTimeout(this._resizeSettleTimer);
    this._mutationObserver?.disconnect();
    this._resizeObserver?.disconnect();

    const el = this.sourceEl;
    el.removeEventListener("scroll", this.invalidate, { capture: true });
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
