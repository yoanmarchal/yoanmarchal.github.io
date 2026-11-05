precision mediump float;

/* Phosphor persistence: each frame is the brighter of what the beam lights
   now and what's left of the previous frame's glow. Both inputs are
   premultiplied, so a per-channel max keeps rgb <= alpha. Also used as a
   plain copy (uDecay = 0) to put the result on screen. */

uniform sampler2D uCurrent;
uniform sampler2D uPrevious;
/* how much of last frame's glow survives this frame - exp(-dt / tau) */
uniform float uDecay;

varying vec2 vUv;

/* 8-bit targets round to nearest, so a faint glow times the decay can round
   back up to itself and never fade out - a dim ghost of old text left on
   the glass for good. Subtracting a little more than half a step each frame
   guarantees it reaches zero. */
const float FLOOR = 1.5 / 255.0;

void main() {
  vec4 current = texture2D(uCurrent, vUv);
  vec4 previous = max(texture2D(uPrevious, vUv) * uDecay - FLOOR, 0.0);
  gl_FragColor = max(current, previous);
}
