import * as THREE from "three";
import vertexShader from "../shaders/textWarp.vert.glsl";
import fragmentShader from "../shaders/textWarp.frag.glsl";

const STRENGTH = 0.12;

// Mirrors the fragment shader's displacement math: for an output pixel at
// (centerX, centerY), the shader samples the source texture at
// `uv + centered * r2 * strength`. Used to keep the real, invisible,
// interactive elements (nav buttons, links) positioned under their own warped
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

function wrapLine(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Mirrors the currently-visible text inside `sourceEl` onto an offscreen
 * 2D canvas every frame, then renders that canvas as a WebGL texture
 * through a barrel-distortion fragment shader onto `canvas`.
 *
 * The real DOM text stays in place underneath (still focusable,
 * selectable, readable by screen readers) - CSS makes its glyphs
 * invisible via -webkit-text-fill-color so only this warped copy shows.
 */
export class TextWarpLayer {
  constructor(canvas, sourceEl) {
    this.canvas = canvas;
    this.sourceEl = sourceEl;
    this.supported = false;
    this._lastWidth = 0;
    this._lastHeight = 0;
    this._strength = STRENGTH;

    this.mirror = document.createElement("canvas");
    this.mirrorCtx = this.mirror.getContext("2d");
    this._hitOffsets = new WeakMap();

    if (!this._setupRenderer()) return;

    this.supported = true;
    this._running = true;
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);

    // Chromium (seen in both headless and windowed Chrome) can leave a
    // stale, ghosted frame composited on this canvas after a resize -
    // reproducibly, byte-for-byte, regardless of how many extra render()
    // calls, canvas-size nudges or display:none/reflow toggles follow it
    // (all tried and empirically verified not to help; the mirror texture
    // and every renderer/canvas dimension are provably correct throughout,
    // so this is a GPU/driver-level cache, not a state bug here). Only a
    // full renderer teardown + rebuild has been found to clear it.
    // Debounced (not run on every polled _tick resize) so a dragged window
    // edge doesn't pay this real, momentarily-visible cost on every
    // intermediate frame.
    this._onWindowResize = this._onWindowResize.bind(this);
    window.addEventListener("resize", this._onWindowResize);
  }

  _setupRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: false,
      });
    } catch {
      return false;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.texture = new THREE.CanvasTexture(this.mirror);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTexture: { value: this.texture },
        uStrength: { value: this._strength },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.material = material;

    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    // a fresh renderer starts at 0x0 - resize it to the current, already-
    // known container size (skipped on the very first setup, where
    // _lastWidth/_lastHeight are still their 0 initial values and _tick's
    // own first-frame resize will size it instead).
    if (this._lastWidth && this._lastHeight) {
      this.renderer.setSize(this._lastWidth, this._lastHeight, false);
    }

    return true;
  }

  // Used by the dev curvature tuner (see src/dev/curvatureTuner.js) to
  // adjust the barrel-warp strength live. Stored on the instance (not just
  // pushed to the current material's uniform) so it survives
  // _recoverFromResize rebuilding the renderer/material from scratch.
  setStrength(value) {
    this._strength = value;
    if (this.material) this.material.uniforms.uStrength.value = value;
  }

  _onWindowResize() {
    clearTimeout(this._resizeSettleTimer);
    this._resizeSettleTimer = setTimeout(() => this._recoverFromResize(), 150);
  }

  _recoverFromResize() {
    if (!this._running) return;

    // Swap in a brand-new <canvas> element rather than reusing this.canvas
    // - a clone never carries over a WebGL context, so the new renderer
    // below is guaranteed a fresh GPU backing store with no possibility of
    // inherited state. Reusing the same element would mean forcing the old
    // context to lose itself first, which is asynchronous (the browser
    // fires 'webglcontextlost' on its own schedule) and racy to build a
    // new renderer around synchronously.
    const staleRenderer = this.renderer;
    const freshCanvas = this.canvas.cloneNode(false);
    this.canvas.replaceWith(freshCanvas);
    this.canvas = freshCanvas;

    this._setupRenderer();
    staleRenderer.dispose();
    staleRenderer.forceContextLoss();

    const rect = this.sourceEl.getBoundingClientRect();
    this._drawMirror(rect);
    this.renderer.render(this.scene, this.camera);
  }

  _resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.mirror.width = Math.max(1, Math.round(width * dpr));
    this.mirror.height = Math.max(1, Math.round(height * dpr));
    this.mirrorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.setSize(width, height, false);
    this._lastWidth = width;
    this._lastHeight = height;
  }

  _drawMirror(originRect) {
    const ctx = this.mirrorCtx;
    ctx.clearRect(0, 0, this._lastWidth, this._lastHeight);
    ctx.textBaseline = "middle";

    // Hit-box alignment runs as its own pass over the real interactive
    // elements, keyed by the element itself - not by collectLeaves below,
    // whose leaves are per-character <span>s once scrambleReveal has
    // wrapped a button/link's text (see e.g. the contact-email link).
    // Using the link's own rect here (rather than one of its char spans)
    // keeps the compensation correct regardless of that internal markup.
    for (const interactiveEl of this.sourceEl.querySelectorAll("button, a")) {
      const iRect = interactiveEl.getBoundingClientRect();
      if (iRect.width <= 0 || iRect.height <= 0) continue;

      const prevOffset = this._hitOffsets.get(interactiveEl);
      const trueRect = prevOffset
        ? new DOMRect(iRect.x - prevOffset.dx, iRect.y - prevOffset.dy, iRect.width, iRect.height)
        : iRect;

      const centerX = trueRect.left - originRect.left + trueRect.width / 2;
      const centerY = trueRect.top - originRect.top + trueRect.height / 2;
      const shaderOffset = computeWarpOffsetPx(centerX, centerY, this._lastWidth, this._lastHeight, STRENGTH);
      const hitOffset = { dx: -shaderOffset.dx, dy: -shaderOffset.dy };
      interactiveEl.style.transform = `translate(${hitOffset.dx}px, ${hitOffset.dy}px)`;
      this._hitOffsets.set(interactiveEl, hitOffset);
    }

    const underlinedThisFrame = new Set();

    for (const el of collectLeaves(this.sourceEl)) {
      let rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      // `el` may itself be a button/link, or (once scrambleReveal has
      // wrapped its text) one of its per-character descendant spans -
      // closest() finds the real interactive element either way.
      const interactiveAncestor = el.closest("a, button");

      // rect may already include the hit-alignment transform applied
      // above (directly, or inherited from that ancestor) - subtract it
      // back out so drawing uses the element's true, untransformed
      // position.
      const hitOffset = interactiveAncestor ? this._hitOffsets.get(interactiveAncestor) : null;
      if (hitOffset) {
        rect = new DOMRect(rect.x - hitOffset.dx, rect.y - hitOffset.dy, rect.width, rect.height);
      }

      const style = getComputedStyle(el);
      const opacity = parseFloat(style.opacity);
      if (!opacity) continue;

      // drawn into the mirror (not as a real CSS outline/shadow on `el`)
      // so it gets warped by the shader in lockstep with the text instead
      // of sitting at a rigid position that drifts from the curved glyphs.
      const isFocused =
        interactiveAncestor !== null &&
        interactiveAncestor === document.activeElement &&
        interactiveAncestor.matches(":focus-visible");

      ctx.globalAlpha = opacity;
      drawBorder(ctx, style, rect.left - originRect.left, rect.top - originRect.top, rect.width, rect.height);

      if (el.tagName === "IMG") {
        ctx.globalAlpha = opacity;
        // drawImage copies raw source pixels - it ignores the element's
        // own CSS filter (e.g. the logo's grayscale/invert), so that has
        // to be re-applied on the canvas context to match.
        ctx.filter = style.filter === "none" ? "none" : style.filter;
        ctx.drawImage(el, rect.left - originRect.left, rect.top - originRect.top, rect.width, rect.height);
        ctx.filter = "none";
        continue;
      }

      const fontSize = parseFloat(style.fontSize);
      let lineHeight = parseFloat(style.lineHeight);
      if (!Number.isFinite(lineHeight)) lineHeight = fontSize * 1.2;

      ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
      ctx.fillStyle = isFocused ? "#ffffff" : style.color;
      ctx.globalAlpha = opacity;
      if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing;
      if (isFocused) {
        ctx.shadowColor = "rgba(242, 242, 242, 0.9)";
        ctx.shadowBlur = 6;
      }

      const align = style.textAlign === "center" || style.textAlign === "right" ? style.textAlign : "left";
      ctx.textAlign = align;

      const x = rect.left - originRect.left + (align === "left" ? 0 : align === "right" ? rect.width : rect.width / 2);
      const localTop = rect.top - originRect.top;

      const isWrapped = rect.height > lineHeight * 1.4;
      if (isWrapped) {
        const lines = wrapLine(ctx, el.textContent, rect.width);
        lines.forEach((line, i) => {
          ctx.fillText(line, x, localTop + lineHeight / 2 + i * lineHeight);
        });
      } else {
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
        const trueARect = hitOffset
          ? new DOMRect(aRect.x - hitOffset.dx, aRect.y - hitOffset.dy, aRect.width, aRect.height)
          : aRect;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const underlineY = trueARect.top - originRect.top + trueARect.height + 2;
        ctx.moveTo(trueARect.left - originRect.left, underlineY);
        ctx.lineTo(trueARect.left - originRect.left + trueARect.width, underlineY);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }

  _tick() {
    if (!this._running) return;

    const rect = this.sourceEl.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);

    if (width !== this._lastWidth || height !== this._lastHeight) {
      this._resize(width, height);
    }

    this._drawMirror(rect);
    this.renderer.render(this.scene, this.camera);

    requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    clearTimeout(this._resizeSettleTimer);
    window.removeEventListener("resize", this._onWindowResize);
  }
}
