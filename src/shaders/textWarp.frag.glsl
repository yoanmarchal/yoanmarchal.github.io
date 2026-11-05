/* highp where available: the scanline phase is computed from a pixel
   coordinate in the thousands, which mediump (fp16 on mobile) can't hold
   precisely enough - the lines would smear into bands */
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uTexture;
uniform float uStrength;
/* source size in CSS px - effect radii and the scanline pitch are expressed
   in CSS px so they look the same at any device pixel ratio */
uniform vec2 uResolution;
/* phosphor color neutral (grey/white) text is tinted towards; saturated
   colors (the accent) are kept as they are */
uniform vec3 uPhosphor;
/* section change: 0 → 1 → 0 over the transition (TextWarpLayer.playGlitch).
   Only reaches below uGlitchTop (source uv y, measured upwards), so the
   hero and nav above the section stay steady */
uniform float uGlitch;
uniform float uGlitchTop;
/* theme change: 1 → 0, a degauss wobble (TextWarpLayer.playDegauss) */
uniform float uDegauss;
/* seconds, for the effects' randomness and wobble */
uniform float uTime;

varying vec2 vUv;

const float PI = 3.14159265;
/* RGB convergence error at the corners, in CSS px (0 at the center) */
const float ABERRATION = 1.2;
const float SCANLINE_PERIOD = 3.0;
const float SCANLINE_DEPTH = 0.22;
const float BLOOM_STRENGTH = 0.5;
/* aperture-grille shadow mask: how much the two "off" subpixels of each
   device-pixel triad are dimmed - kept faint, it should only read up close */
const float MASK_DEPTH = 0.08;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

/* the texture is premultiplied, so saturation is measured relative to alpha */
vec4 tint(vec4 c) {
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float saturation = (hi - lo) / max(c.a, 0.0001);
  float neutral = 1.0 - smoothstep(0.08, 0.3, saturation);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  return vec4(mix(c.rgb, luma * uPhosphor, neutral), c.a);
}

/* single-pass glow approximation: 8 taps around the pixel, alternating
   between a near and a far radius (a star of two rings for half the reads
   of two full ones) */
vec4 bloom(vec2 uv) {
  vec2 px = 1.0 / uResolution;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float angle = float(i) * PI * 0.25;
    float far = mod(float(i), 2.0);
    float reach = mix(2.5, 6.0, far);
    sum += texture2D(uTexture, uv + vec2(cos(angle), sin(angle)) * px * reach) * mix(1.0, 0.6, far);
  }
  return sum / (4.0 * 1.6);
}

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

  /* `uv` is where the signal is read from - the effects below disturb it,
     while `warped` stays the glass itself (scanlines, edges) */
  vec2 uv = warped;

  /* degauss: the picture wobbles as the coil's field decays */
  if (uDegauss > 0.0) {
    uv += vec2(sin(uv.y * 18.0 + uTime * 38.0), cos(uv.x * 14.0 + uTime * 31.0)) * 0.006 * uDegauss;
  }

  /* lost horizontal sync: random bands of lines tear sideways, re-rolled
     ~30 times a second, plus a slight vertical jump */
  /* fades in just below the section's top rather than starting on a hard
     line across the screen */
  float glitch = uGlitch * (1.0 - smoothstep(uGlitchTop - 0.04, uGlitchTop, uv.y));
  if (glitch > 0.0) {
    float band = floor(uv.y * uResolution.y / 14.0);
    float frame = floor(uTime * 30.0);
    float roll = hash(vec2(band, frame));
    float tear = smoothstep(0.4, 1.0, roll);
    uv.x += (hash(vec2(frame, band * 1.7)) - 0.5) * 0.2 * tear * glitch;
    uv.y += (hash(vec2(frame, 3.1)) - 0.5) * 0.01 * glitch;
  }

  /* chromatic aberration: red and blue land slightly apart from green,
     radially, growing towards the edges like a real tube's misconvergence -
     and spreading further while the signal is disturbed */
  vec2 offset = centered * r2 * 4.0 * ABERRATION / uResolution;
  offset = offset * (1.0 + 6.0 * glitch + 10.0 * uDegauss) + vec2(4.0 * glitch, 0.0) / uResolution;
  vec4 base = texture2D(uTexture, uv);
  vec4 red = texture2D(uTexture, uv + offset);
  vec4 blue = texture2D(uTexture, uv - offset);
  vec4 color = tint(vec4(red.r, base.g, blue.b, max(base.a, max(red.a, blue.a))));

  /* scanlines sampled in the warped space, so they bend with the text
     instead of cutting straight across it */
  float phase = warped.y * uResolution.y * 2.0 * PI / SCANLINE_PERIOD;
  color *= 1.0 - SCANLINE_DEPTH * (0.5 + 0.5 * cos(phase));

  /* glow added after the scanlines: like phosphor bleed, it fills the
     dark gaps between them around bright text */
  color += tint(bloom(uv)) * BLOOM_STRENGTH;

  /* the glitch also dims the section and adds faint snow - late (squared),
     so the tearing reads first, but dark enough at its peak to hide the
     content being swapped underneath */
  if (glitch > 0.0) {
    color *= 1.0 - 0.85 * glitch * glitch;
    float snow = hash(gl_FragCoord.xy + fract(uTime) * 100.0) * 0.035 * glitch;
    color += vec4(uPhosphor * snow, snow);
  }

  /* degauss color blotches drifting across the tube */
  if (uDegauss > 0.0) {
    vec3 blotch = vec3(
      sin(uv.x * 9.0 + uTime * 20.0),
      sin(uv.y * 7.0 + uTime * 17.0 + 2.0),
      sin((uv.x + uv.y) * 8.0 + uTime * 23.0 + 4.0)
    );
    color.rgb *= 1.0 + blotch * 0.5 * uDegauss;
  }

  float triad = mod(gl_FragCoord.x, 3.0);
  vec3 mask = vec3(1.0 - MASK_DEPTH);
  if (triad < 1.0) mask.r = 1.0;
  else if (triad < 2.0) mask.g = 1.0;
  else mask.b = 1.0;
  color.rgb *= mask;

  /* premultiplied: the context composites with premultipliedAlpha, so rgb
     must stay <= alpha (the degauss blotches can push it over) */
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(min(color.rgb, vec3(color.a)), color.a);
}
