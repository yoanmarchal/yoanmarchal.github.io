// Phosphor themes - which color the tube glows in. The CSS side (text,
// accent, focus, screen background) lives in screenFrame.css under
// html[data-theme]; this holds what the WebGL layer needs on top of it:
// `phosphor`, the tint TextWarpLayer's shader gives neutral pixels (and its
// section-change snow).

const STORAGE_KEY = "crt-theme";

export const THEMES = {
  blanc: {
    label: "blanc",
    phosphor: [0.93, 0.97, 1.0],
  },
  ambre: {
    label: "ambre",
    phosphor: [1.0, 0.68, 0.18],
  },
  vert: {
    label: "vert",
    phosphor: [0.4, 1.0, 0.55],
  },
};

export const THEME_NAMES = Object.keys(THEMES);
export const DEFAULT_THEME = "blanc";

// English names typed out of habit still work
const ALIASES = { white: "blanc", amber: "ambre", green: "vert" };

export function resolveThemeName(name) {
  const key = ALIASES[name] ?? name;
  return key in THEMES ? key : null;
}

const listeners = new Set();
let current = DEFAULT_THEME;

function readStored() {
  try {
    return resolveThemeName(localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    // storage blocked (privacy mode, sandboxed iframe)
    return null;
  }
}

export function getTheme() {
  return current;
}

export function getThemeConfig(name = current) {
  return THEMES[name];
}

/** Applies a theme by name (or alias). Returns the applied name, or null if unknown. */
export function setTheme(name, { persist = true } = {}) {
  const key = resolveThemeName(name);
  if (!key) return null;
  current = key;
  document.documentElement.dataset.theme = key;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // the theme still applies for this visit
    }
  }
  listeners.forEach((listener) => listener(THEMES[key], key));
  return key;
}

/** Calls `listener(config, name)` now and on every later theme change. */
export function onThemeChange(listener) {
  listeners.add(listener);
  listener(THEMES[current], current);
  return () => listeners.delete(listener);
}

export function initTheme() {
  setTheme(readStored() ?? DEFAULT_THEME, { persist: false });
}
