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

    this.mirror = document.createElement("canvas");
    this.mirrorCtx = this.mirror.getContext("2d");
    this._hitOffsets = new WeakMap();

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
      });
    } catch {
      return;
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
        uStrength: { value: STRENGTH },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    this.supported = true;
    this._running = true;
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
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

    for (const el of collectLeaves(this.sourceEl)) {
      let rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      // rect may already include last frame's hit-alignment transform
      // (see below) - subtract it back out so drawing uses the element's
      // true, untransformed position.
      const prevHitOffset = this._hitOffsets.get(el);
      if (prevHitOffset) {
        rect = new DOMRect(rect.x - prevHitOffset.dx, rect.y - prevHitOffset.dy, rect.width, rect.height);
      }

      const style = getComputedStyle(el);
      const opacity = parseFloat(style.opacity);
      if (!opacity) continue;

      ctx.globalAlpha = opacity;
      drawBorder(ctx, style, rect.left - originRect.left, rect.top - originRect.top, rect.width, rect.height);

      if (el.tagName === "BUTTON" || el.tagName === "A") {
        // keep the real (invisible) interactive hit-box aligned with
        // where the shader visually displaces this element's mirrored
        // text, so hover/click land where the text actually appears.
        const centerX = rect.left - originRect.left + rect.width / 2;
        const centerY = rect.top - originRect.top + rect.height / 2;
        const shaderOffset = computeWarpOffsetPx(centerX, centerY, this._lastWidth, this._lastHeight, STRENGTH);
        const hitOffset = { dx: -shaderOffset.dx, dy: -shaderOffset.dy };
        el.style.transform = `translate(${hitOffset.dx}px, ${hitOffset.dy}px)`;
        this._hitOffsets.set(el, hitOffset);
      }

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
      ctx.fillStyle = style.color;
      ctx.globalAlpha = opacity;
      if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing;

      const align = style.textAlign === "center" || style.textAlign === "right" ? style.textAlign : "left";
      ctx.textAlign = align;

      const x = rect.left - originRect.left + (align === "left" ? 0 : align === "right" ? rect.width : rect.width / 2);
      const localTop = rect.top - originRect.top;

      const isWrapped = rect.height > lineHeight * 1.4;
      if (!isWrapped) {
        ctx.fillText(el.textContent, x, localTop + rect.height / 2);
        continue;
      }

      const lines = wrapLine(ctx, el.textContent, rect.width);
      lines.forEach((line, i) => {
        ctx.fillText(line, x, localTop + lineHeight / 2 + i * lineHeight);
      });
    }

    ctx.globalAlpha = 1;
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
  }
}
