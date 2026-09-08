// Single source of truth for CRT curvature: the #crtClip SVG bezier
// (index.html) and the text-warp shader strength (TextWarpLayer /
// textWarp.frag.glsl) are visually two different mechanisms, but they're
// meant to read as one "how curved is this screen" knob - so both are
// derived here from the same `intensity` multiplier rather than tuned
// independently. intensity=1 is the full desktop CRT look; intensity=0
// is a flat rectangle with no text warp, used on mobile (see
// MOBILE_QUERY - same breakpoint screenFrame.css already dials the
// font-size back at).

export const CURVATURE_BASE = {
  insetX: 0.06,
  insetY: 0.02,
  bulgeX: 0.045,
  bulgeY: 0.035,
  strength: 0.185,
};

export const MOBILE_QUERY = "(max-width: 640px)";

export function scaleCurvature(base, intensity) {
  return {
    insetX: base.insetX * intensity,
    insetY: base.insetY * intensity,
    bulgeX: base.bulgeX * intensity,
    bulgeY: base.bulgeY * intensity,
    strength: base.strength * intensity,
  };
}

// Builds the #crtClip path's `d` attribute from the four shape params.
// insetX/insetY pull the four corners in from the bounding-box edges;
// bulgeX/bulgeY push each edge's midpoint control points back out past
// the corners, bulging into the tube shape. All zero -> a plain
// full-bbox rectangle (no curvature).
export function buildClipPathD({ insetX, insetY, bulgeX, bulgeY }) {
  const left = insetX;
  const right = 1 - insetX;
  const top = insetY;
  const bottom = 1 - insetY;
  const width = right - left;
  const height = bottom - top;

  const topCtrlY = top - bulgeY;
  const bottomCtrlY = bottom + bulgeY;
  const rightCtrlX = right + bulgeX;
  const leftCtrlX = left - bulgeX;

  const topCtrlX1 = left + width / 3;
  const topCtrlX2 = right - width / 3;
  const sideCtrlY1 = top + height * 0.27;
  const sideCtrlY2 = bottom - height * 0.27;

  const n = (v) => v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

  return [
    `M ${n(left)},${n(top)}`,
    `C ${n(topCtrlX1)},${n(topCtrlY)} ${n(topCtrlX2)},${n(topCtrlY)} ${n(right)},${n(top)}`,
    `C ${n(rightCtrlX)},${n(sideCtrlY1)} ${n(rightCtrlX)},${n(sideCtrlY2)} ${n(right)},${n(bottom)}`,
    `C ${n(topCtrlX2)},${n(bottomCtrlY)} ${n(topCtrlX1)},${n(bottomCtrlY)} ${n(left)},${n(bottom)}`,
    `C ${n(leftCtrlX)},${n(sideCtrlY2)} ${n(leftCtrlX)},${n(sideCtrlY1)} ${n(left)},${n(top)} Z`,
  ].join(" ");
}

// Applies desktop (intensity 1) or mobile (intensity 0) curvature to the
// clip path + text-warp layer, and keeps it in sync as the viewport
// crosses MOBILE_QUERY (device rotation, devtools responsive mode,
// resizing a desktop window narrow).
export function initResponsiveCurvature(textWarp) {
  const clipPath = document.querySelector("#crtClip path");
  const mql = window.matchMedia(MOBILE_QUERY);

  function apply() {
    const intensity = mql.matches ? 0 : 1;
    const curvature = scaleCurvature(CURVATURE_BASE, intensity);
    if (clipPath) clipPath.setAttribute("d", buildClipPathD(curvature));
    textWarp.setStrength(curvature.strength);
  }

  apply();
  mql.addEventListener("change", apply);
}
