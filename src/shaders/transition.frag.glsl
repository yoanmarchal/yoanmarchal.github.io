precision mediump float;

uniform float uProgress;
uniform float uTime;
uniform vec2 uResolution;

varying vec2 vUv;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;

  /* rises to 1 at mid-transition, falls back to 0 — this is the moment
     the DOM content actually swaps underneath, so the flash must be
     opaque enough right there to hide the swap */
  float envelope = sin(uProgress * 3.14159265);

  float band = floor(uv.y * 48.0);
  float glitch = (random(vec2(band, floor(uTime * 24.0))) - 0.5) * envelope * 0.08;
  uv.x += glitch;

  float sweep = 1.0 - smoothstep(0.0, 0.05, abs(uv.y - uProgress));
  float noise = random(uv * uResolution.xy * 0.4 + uTime * 60.0);

  float scanline = step(0.5, fract(uv.y * uResolution.y * 0.5));

  float alpha = envelope * (0.5 + 0.35 * noise + 0.25 * scanline);
  alpha = clamp(alpha + sweep * 0.65 * envelope, 0.0, 1.0);

  vec3 color = mix(vec3(0.06, 0.06, 0.06), vec3(0.95, 0.95, 0.95), noise);

  /* premultiplied: the context composites with premultipliedAlpha */
  gl_FragColor = vec4(color * alpha, alpha);
}
