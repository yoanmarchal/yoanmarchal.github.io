precision mediump float;

uniform sampler2D uTexture;
uniform float uStrength;

varying vec2 vUv;

void main() {
  /* radial barrel warp: displacement grows with the square of the
     distance from center, so it's ~0 near the middle of the screen and
     strongest at the corners - mirrors real CRT tube curvature */
  vec2 centered = vUv - 0.5;
  float r2 = dot(centered, centered);
  vec2 warped = vUv + centered * r2 * uStrength;

  if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
    discard;
  }

  gl_FragColor = texture2D(uTexture, warped);
}
