import vertexShader from "../shaders/quad.vert.glsl";
import fragmentShader from "../shaders/transition.frag.glsl";
import { createQuadProgram, getWebGLContext, sizeCanvas } from "./gl.js";

const DURATION_MS = 550;

export class SectionTransition {
  constructor(canvas) {
    this.canvas = canvas;
    this.supported = false;

    const gl = getWebGLContext(canvas);
    if (!gl) return;

    try {
      this.quad = createQuadProgram(gl, vertexShader, fragmentShader);
    } catch {
      return;
    }

    this.gl = gl;
    this.supported = true;
    // the transition is purely decorative - if the GPU drops the context,
    // just swap panels without it from then on
    canvas.addEventListener("webglcontextlost", () => {
      this.supported = false;
    });
  }

  play(onMidpoint) {
    if (!this.supported) {
      onMidpoint();
      return Promise.resolve();
    }

    const { gl, quad, canvas } = this;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    sizeCanvas(canvas, width, height);

    quad.use();
    gl.uniform2f(quad.uniform("uResolution"), width, height);

    return new Promise((resolve) => {
      const start = performance.now();
      let swapped = false;

      const tick = (now) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / DURATION_MS, 1);

        gl.viewport(0, 0, canvas.width, canvas.height);
        quad.use();
        gl.uniform1f(quad.uniform("uProgress"), t);
        gl.uniform1f(quad.uniform("uTime"), elapsed / 1000);
        quad.draw();

        if (!swapped && t >= 0.5) {
          swapped = true;
          onMidpoint();
        }

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          resolve();
        }
      };

      requestAnimationFrame(tick);
    });
  }
}
