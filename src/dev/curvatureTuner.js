// Dev-only debug panel for fine-tuning CRT curvature. Only ever imported
// from main.js behind `import.meta.env.DEV`, so none of this ships in the
// production build.
//
// Mirrors the production model in src/scene/curvature.js: a `base` shape
// (the desktop-max look) scaled by a single `intensity` multiplier that
// the real site sets to 1 on desktop / 0 on mobile (see
// initResponsiveCurvature). The "intensity" slider here previews that
// same correlation live - drag it to 0 to confirm the clip curvature and
// text-warp strength both flatten out together, exactly as they will on
// a phone.
import { CURVATURE_BASE, MOBILE_QUERY, buildClipPathD, scaleCurvature } from "../scene/curvature.js";

const BASE_FIELDS = [
  { key: "insetX", label: "clip inset X", min: 0, max: 0.2, step: 0.001 },
  { key: "insetY", label: "clip inset Y", min: 0, max: 0.15, step: 0.001 },
  { key: "bulgeX", label: "clip bulge X", min: 0, max: 0.15, step: 0.001 },
  { key: "bulgeY", label: "clip bulge Y", min: 0, max: 0.1, step: 0.001 },
  { key: "strength", label: "text warp strength", min: 0, max: 0.4, step: 0.001 },
];

function fmt(v) {
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function initCurvatureTuner(textWarp) {
  const clipPath = document.querySelector("#crtClip path");
  if (!clipPath) return;

  const base = { ...CURVATURE_BASE };
  // reflects the real breakpoint on load, so opening the panel doesn't
  // silently override whatever curvature the page actually applied
  let intensity = window.matchMedia(MOBILE_QUERY).matches ? 0 : 1;
  const inputs = {};
  const valueEls = {};

  function apply() {
    const curvature = scaleCurvature(base, intensity);
    clipPath.setAttribute("d", buildClipPathD(curvature));
    textWarp.setStrength(curvature.strength);
  }

  const panel = document.createElement("div");
  panel.id = "crt-curvature-tuner";
  panel.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 9999;
    background: rgba(10, 10, 10, 0.92); color: #f2f2f2;
    font: 11px ui-monospace, Consolas, monospace; padding: 10px 12px;
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px;
    width: 230px; user-select: text; line-height: 1.4;
  `;

  const title = document.createElement("div");
  title.textContent = "CRT curvature tuner (dev)";
  title.style.cssText = "font-weight: bold; margin-bottom: 4px; opacity: 0.9;";
  panel.appendChild(title);

  function addSlider({ key, label, min, max, step }, getValue, onChange) {
    const row = document.createElement("label");
    row.style.cssText = "display: block; margin: 6px 0;";

    const top = document.createElement("div");
    top.style.cssText = "display: flex; justify-content: space-between; gap: 6px;";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    const valueSpan = document.createElement("span");
    valueSpan.textContent = fmt(getValue());
    valueEls[key] = valueSpan;
    top.append(labelSpan, valueSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(getValue());
    input.style.cssText = "width: 100%; display: block;";
    input.addEventListener("input", () => {
      onChange(parseFloat(input.value));
      valueSpan.textContent = fmt(getValue());
      apply();
    });
    inputs[key] = input;

    row.append(top, input);
    panel.appendChild(row);
    return input;
  }

  const intensityNote = document.createElement("div");
  intensityNote.textContent = "correlates clip + warp - 0 = mobile flat, 1 = desktop CRT";
  intensityNote.style.cssText = "opacity: 0.6; margin-bottom: 4px; font-size: 10px;";
  panel.appendChild(intensityNote);

  addSlider(
    { key: "intensity", label: "intensity", min: 0, max: 1, step: 0.01 },
    () => intensity,
    (v) => (intensity = v),
  );

  const sep = document.createElement("div");
  sep.style.cssText = "border-top: 1px solid rgba(255,255,255,0.15); margin: 8px 0; padding-top: 2px; opacity: 0.6;";
  sep.textContent = "desktop-max shape:";
  panel.appendChild(sep);

  for (const field of BASE_FIELDS) {
    addSlider(
      field,
      () => base[field.key],
      (v) => (base[field.key] = v),
    );
  }

  const buttonRow = document.createElement("div");
  buttonRow.style.cssText = "display: flex; gap: 6px; margin-top: 8px;";

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.type = "button";
  resetBtn.addEventListener("click", () => {
    Object.assign(base, CURVATURE_BASE);
    intensity = 1;
    inputs.intensity.value = "1";
    valueEls.intensity.textContent = fmt(1);
    for (const { key } of BASE_FIELDS) {
      inputs[key].value = String(base[key]);
      valueEls[key].textContent = fmt(base[key]);
    }
    apply();
  });

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy base";
  copyBtn.type = "button";
  copyBtn.addEventListener("click", () => {
    const text = [
      `// paste into src/scene/curvature.js CURVATURE_BASE`,
      `insetX: ${fmt(base.insetX)},`,
      `insetY: ${fmt(base.insetY)},`,
      `bulgeX: ${fmt(base.bulgeX)},`,
      `bulgeY: ${fmt(base.bulgeY)},`,
      `strength: ${fmt(base.strength)},`,
    ].join("\n");
    navigator.clipboard?.writeText(text).catch(() => {});
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy base"), 1000);
  });

  for (const btn of [resetBtn, copyBtn]) {
    btn.style.cssText = `
      flex: 1; background: rgba(255, 255, 255, 0.08); color: inherit;
      border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 3px;
      padding: 4px 6px; font: inherit; cursor: pointer;
    `;
  }

  buttonRow.append(resetBtn, copyBtn);
  panel.appendChild(buttonRow);

  document.body.appendChild(panel);

  apply();
}
