// The tube powering off and back on, like a real CRT: the picture collapses
// into a bright horizontal line, then a dot that fades - and on the way back
// the dot stretches into a line that opens up into the full picture.
//
// Played on demand (the prompt's `exit` command) and when the page comes
// back after being hidden for a while - the "power off" itself can't be
// seen while the tab is hidden, so only the power-on is replayed then.
//
// Animated with the Web Animations API on the layer that actually shows the
// picture (the WebGL canvas, or the DOM text when WebGL is off) - never on
// .screen-inner while TextWarpLayer runs, whose measurements a transform
// would skew. The off state itself is a class, not a held animation fill,
// so it survives TextWarpLayer swapping in a fresh canvas.

const POWER_ON_MS = 750;
const POWER_OFF_MS = 900;
// on arrival: the screen stays fully dark for a beat (the page settles, the
// eye lands on the black glass), then the dot glows alone for a moment,
// like a tube warming up, before it opens up
const ARRIVAL_PAUSE_MS = 700;
const WARM_UP_MS = 350;
// a quick tab switch isn't a power cycle
const MIN_HIDDEN_MS = 1000;
const OFF_CLASS = "is-powered-off";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const DOT = "scale(0.002, 0.003)";
const LINE = "scale(1, 0.004)";
const FULL = "scale(1, 1)";

const IMAGE_ON = [
  { offset: 0, transform: DOT, filter: "brightness(4)" },
  { offset: 0.3, transform: LINE, filter: "brightness(4)", easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  { offset: 0.65, transform: FULL, filter: "brightness(1.8)" },
  { offset: 1, transform: FULL, filter: "brightness(1)" },
];

const BEAM_ON = [
  { offset: 0, transform: "scaleX(0.004)", opacity: 1 },
  { offset: 0.3, transform: "scaleX(1)", opacity: 1 },
  { offset: 0.6, transform: "scaleX(1) scaleY(24)", opacity: 0 },
  { offset: 1, transform: "scaleX(1) scaleY(24)", opacity: 0 },
];

const DARK_ON = [
  { offset: 0, opacity: 1 },
  { offset: 0.65, opacity: 0 },
  { offset: 1, opacity: 0 },
];

const IMAGE_OFF = [
  { offset: 0, transform: FULL, filter: "brightness(1)", opacity: 1, easing: "cubic-bezier(0.7, 0, 0.9, 0.4)" },
  { offset: 0.4, transform: LINE, filter: "brightness(3)", opacity: 1 },
  { offset: 0.65, transform: DOT, filter: "brightness(4)", opacity: 1 },
  { offset: 0.7, transform: DOT, filter: "brightness(4)", opacity: 0 },
  { offset: 1, transform: DOT, filter: "brightness(4)", opacity: 0 },
];

const BEAM_OFF = [
  { offset: 0, transform: "scaleX(1)", opacity: 0 },
  { offset: 0.38, transform: "scaleX(1)", opacity: 0 },
  { offset: 0.42, transform: "scaleX(1)", opacity: 1 },
  { offset: 0.65, transform: "scaleX(0.004)", opacity: 1 },
  // the dot's afterglow lingers, then fades
  { offset: 1, transform: "scaleX(0.004)", opacity: 0 },
];

const DARK_OFF = [
  { offset: 0, opacity: 0 },
  { offset: 0.4, opacity: 0 },
  { offset: 1, opacity: 1 },
];

/**
 * Adds the power layers to `screen` (the .crt-screen) and returns
 * { start, powerOff, isOff } - `start` is the power-on on arrival. While off, the next key press or click turns it back
 * on (and is swallowed, so it doesn't also type into the prompt).
 */
export function createCrtPower(screen) {
  const dark = document.createElement("div");
  dark.className = "crt-power";
  dark.setAttribute("aria-hidden", "true");

  const beamWrap = document.createElement("div");
  beamWrap.className = "crt-beam";
  beamWrap.setAttribute("aria-hidden", "true");
  // the part that's scaled into a line/dot - the wrapper carries the glow
  const beam = document.createElement("div");
  beam.className = "crt-beam-core";
  beamWrap.append(beam);

  screen.append(dark, beamWrap);

  let off = false;
  let running = [];

  function image() {
    const inner = screen.querySelector(".screen-inner");
    return inner.classList.contains("crt-warp-active") ? screen.querySelector(".text-warp-canvas") : inner;
  }

  // `delay` holds the first keyframe (fill: backwards) until it starts
  function play(frames, duration, delay = 0) {
    running.forEach((animation) => animation.cancel());
    running = [
      [image(), frames.image],
      [beam, frames.beam],
      [dark, frames.dark],
    ].map(([el, keyframes]) => el.animate(keyframes, { duration, delay, easing: "ease-out", fill: "backwards" }));
    return Promise.all(running.map((animation) => animation.finished)).then(
      () => true,
      // cancelled by a newer power change
      () => false
    );
  }

  function clear() {
    running.forEach((animation) => animation.cancel());
    running = [];
  }

  // resolves once the picture is fully up
  async function powerOn(delay = 0) {
    off = false;
    // the keyframes start from the off look, so dropping the class in the
    // same task never shows a frame of the full picture
    screen.classList.remove(OFF_CLASS);
    if (prefersReducedMotion()) return;
    const done = await play({ image: IMAGE_ON, beam: BEAM_ON, dark: DARK_ON }, POWER_ON_MS, delay);
    if (done) clear();
  }

  // The power-on on arrival: the screen starts off (call this before the
  // first paint) and turns on - once the page is actually visible, so a
  // site opened in a background tab still plays it when looked at.
  async function start() {
    if (prefersReducedMotion()) return;
    screen.classList.add(OFF_CLASS);
    if (document.hidden) {
      await new Promise((resolve) => {
        const onVisible = () => {
          if (document.hidden) return;
          document.removeEventListener("visibilitychange", onVisible);
          resolve();
        };
        document.addEventListener("visibilitychange", onVisible);
      });
    }
    await new Promise((resolve) => setTimeout(resolve, ARRIVAL_PAUSE_MS));
    // the boot waits on this: never let it hang on an animation whose
    // `finished` doesn't come (throttled or frozen timelines)
    await Promise.race([
      powerOn(WARM_UP_MS),
      new Promise((resolve) => setTimeout(resolve, WARM_UP_MS + POWER_ON_MS + 500)),
    ]);
  }

  function onWake(event) {
    if (event.type === "keydown" && ["Alt", "Control", "Meta", "Shift", "Tab"].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.removeEventListener("keydown", onWake, true);
    window.removeEventListener("pointerdown", onWake, true);
    powerOn();
  }

  async function powerOff() {
    if (off) return;
    off = true;
    if (!prefersReducedMotion()) {
      const done = await play({ image: IMAGE_OFF, beam: BEAM_OFF, dark: DARK_OFF }, POWER_OFF_MS);
      if (!done || !off) return;
    }
    screen.classList.add(OFF_CLASS);
    clear();
    // listening only once it's fully off, so the Enter that typed `exit`
    // can't turn it straight back on
    window.addEventListener("keydown", onWake, true);
    window.addEventListener("pointerdown", onWake, true);
  }

  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = performance.now();
      // (hiddenAt stays 0 for a page opened in a background tab - its first
      // showing is the boot, not a power cycle)
    } else if (hiddenAt && !off && !prefersReducedMotion() && performance.now() - hiddenAt >= MIN_HIDDEN_MS) {
      screen.classList.add(OFF_CLASS);
      powerOn();
    }
  });

  return {
    start,
    powerOff,
    isOff: () => off,
  };
}
