// Minimal raw-WebGL helpers for the two full-screen shader quads - all
// either layer needs is one program, one clip-space quad and a handful of
// uniforms, which doesn't justify shipping a whole 3D engine.

export const MAX_PIXEL_RATIO = 2;

export function getWebGLContext(canvas) {
  try {
    return canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
    });
  } catch {
    return null;
  }
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

/**
 * Links `vertexSource`/`fragmentSource` into a program drawn over a single
 * clip-space quad. The vertex shader receives it as `attribute vec2 position`.
 * Throws if compilation or linking fails.
 */
export function createQuadProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader program link failed: ${gl.getProgramInfoLog(program)}`);
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const positionLocation = gl.getAttribLocation(program, "position");
  const uniformLocations = new Map();

  return {
    use() {
      gl.useProgram(program);
    },
    uniform(name) {
      if (!uniformLocations.has(name)) {
        uniformLocations.set(name, gl.getUniformLocation(program, name));
      }
      return uniformLocations.get(name);
    },
    draw() {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

/** Sizes `canvas`'s backing store to `width`x`height` CSS px at the capped DPR. */
export function sizeCanvas(canvas, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  return dpr;
}

export function loseContext(gl) {
  if (!gl || gl.isContextLost()) return;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}
