import "./ui/screenFrame.css";
import { content } from "./data/content.js";
import { renderNav, setActiveTab } from "./ui/Nav.js";
import { renderProfil } from "./ui/sections/Profil.js";
import { renderCompetences } from "./ui/sections/Competences.js";
import { renderExperience } from "./ui/sections/Experience.js";
import { renderProjets } from "./ui/sections/Projets.js";
import { renderContact } from "./ui/sections/Contact.js";
import { ROUTES, ROUTE_LABELS, getCurrentRoute, navigateTo, onRouteChange } from "./router.js";
import { SectionTransition } from "./scene/SectionTransition.js";
import { TextWarpLayer } from "./scene/TextWarpLayer.js";
import { animateReveal, scrambleReveal } from "./ui/scrambleReveal.js";

const SECTION_RENDERERS = {
  profil: renderProfil,
  competences: renderCompetences,
  experience: renderExperience,
  projets: renderProjets,
  contact: renderContact,
};

// once the boot has played in this tab, reloads/revisits skip straight to
// the content instead of replaying the whole sequence
const BOOT_SEEN_KEY = "crt-boot-seen";

const CURSOR_BLINK_MS = 530;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readBootSeen() {
  try {
    return sessionStorage.getItem(BOOT_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markBootSeen() {
  try {
    sessionStorage.setItem(BOOT_SEEN_KEY, "1");
  } catch {
    // storage blocked - the boot simply plays again next time
  }
}

// Lets any key/click/tap jump the boot sequence to its end: every step
// below either checks `skip.skipped` or resolves early via onSkip.
function createSkipSignal() {
  let skipped = false;
  const handlers = new Set();
  return {
    get skipped() {
      return skipped;
    },
    trigger() {
      if (skipped) return;
      skipped = true;
      handlers.forEach((handler) => handler());
      handlers.clear();
    },
    onSkip(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

const bootSkip = createSkipSignal();

function isBootInstant() {
  return prefersReducedMotion() || bootSkip.skipped;
}

function bootWait(ms) {
  if (isBootInstant()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeoutId);
      off();
      resolve();
    };
    const timeoutId = setTimeout(done, ms);
    const off = bootSkip.onSkip(done);
  });
}

async function bootType(el, text) {
  if (isBootInstant()) {
    el.textContent = text;
    return;
  }
  const { finish, promise } = scrambleReveal(el, text);
  const off = bootSkip.onSkip(finish);
  await promise;
  off();
}

function buildShell() {
  const app = document.getElementById("app");

  const crtScreen = document.createElement("div");
  crtScreen.className = "crt-screen";

  const crtOverlay = document.createElement("div");
  crtOverlay.className = "crt-overlay";
  crtOverlay.setAttribute("aria-hidden", "true");

  const crtFlicker = document.createElement("div");
  crtFlicker.className = "crt-flicker";
  crtFlicker.setAttribute("aria-hidden", "true");

  const crtGlass = document.createElement("div");
  crtGlass.className = "crt-glass";
  crtGlass.setAttribute("aria-hidden", "true");

  const transitionCanvas = document.createElement("canvas");
  transitionCanvas.className = "transition-canvas";
  transitionCanvas.setAttribute("aria-hidden", "true");

  const textWarpCanvas = document.createElement("canvas");
  textWarpCanvas.className = "text-warp-canvas";
  textWarpCanvas.setAttribute("aria-hidden", "true");

  const inner = document.createElement("div");
  inner.className = "screen-inner is-centering";

  const panelsWrap = document.createElement("div");
  panelsWrap.className = "panels";

  crtScreen.append(crtOverlay, transitionCanvas, textWarpCanvas, crtFlicker, crtGlass, inner);
  app.append(crtScreen);

  // adds .crt-warp-active to `inner` itself once WebGL is up (and removes
  // it again if the context is ever lost)
  new TextWarpLayer(textWarpCanvas, inner);

  return { inner, panelsWrap, transitionCanvas };
}

function buildHero() {
  const hero = document.createElement("header");
  hero.className = "hero";

  const logo = document.createElement("img");
  logo.className = "logo";
  logo.src = `${import.meta.env.BASE_URL}images/yoanmarchal-logo.png`;
  logo.alt = "";

  const name = document.createElement("h1");
  const job = document.createElement("span");
  const sep = document.createElement("span");
  sep.className = "tagline-sep";
  sep.textContent = "//";
  const location = document.createElement("span");

  const meta = document.createElement("p");
  meta.className = "tagline";
  meta.append(job, sep, location);

  const textWrap = document.createElement("div");
  textWrap.append(name, meta);

  hero.append(logo, textWrap);

  return { hero, logo, name, sep, job, location };
}

// A blinking block cursor on a prompt line after the current panel, like a
// terminal waiting for input. Blinks by toggling a class from JS rather than
// an infinite CSS animation, so TextWarpLayer only redraws on each toggle
// instead of being kept rendering every frame.
function buildPrompt() {
  const prompt = document.createElement("p");
  prompt.className = "prompt";
  prompt.setAttribute("aria-hidden", "true");

  const caret = document.createElement("span");
  caret.textContent = ">";

  const cursor = document.createElement("span");
  cursor.className = "cursor";
  cursor.textContent = "█";

  prompt.append(caret, cursor);

  if (!prefersReducedMotion()) {
    setInterval(() => cursor.classList.toggle("is-off"), CURSOR_BLINK_MS);
  }

  return prompt;
}

async function runPreloader(inner) {
  if (isBootInstant()) return;

  const preloader = document.createElement("div");
  preloader.className = "preloader";
  inner.appendChild(preloader);

  for (const line of content.preloader.lines) {
    if (isBootInstant()) break;
    const p = document.createElement("p");
    p.className = "boot-line";
    preloader.appendChild(p);
    await bootType(p, `> ${line}`);
    await bootWait(150);
  }

  await bootWait(450);
  preloader.remove();
}

// Reveals the hero centered - logo, then name, job title and location one
// at a time - then FLIP-animates it up to its normal in-flow position at
// the top of the screen once the nav/panels are about to appear alongside
// it.
async function revealHero(inner, heroRefs) {
  const { hero, logo, name, sep, job, location } = heroRefs;
  inner.appendChild(hero);

  if (!isBootInstant()) {
    logo.classList.add("logo--enter");
    await wait(30);
    logo.classList.remove("logo--enter");
    await bootWait(300);
  }

  await bootType(name, content.hero.name.toUpperCase());
  await bootWait(120);

  await bootType(job, content.hero.title.toUpperCase());
  await bootWait(120);

  sep.classList.add("is-visible");
  await bootWait(150);

  await bootType(location, content.hero.location.toUpperCase());
  await bootWait(600);

  const firstRect = hero.getBoundingClientRect();
  inner.classList.remove("is-centering");
  if (isBootInstant()) return;

  const lastRect = hero.getBoundingClientRect();
  const dx = firstRect.left - lastRect.left;
  const dy = firstRect.top - lastRect.top;
  if (dx === 0 && dy === 0) return;

  hero.style.transition = "none";
  hero.style.transform = `translate(${dx}px, ${dy}px)`;

  await new Promise((resolve) => requestAnimationFrame(resolve));

  hero.style.transition = "transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)";
  hero.style.transform = "translate(0, 0)";

  await new Promise((resolve) => {
    const done = () => {
      clearTimeout(safetyTimer);
      off();
      resolve();
    };
    // transitionend can go missing (e.g. tab hidden mid-move) - never let
    // the boot hang on it
    const safetyTimer = setTimeout(done, 1000);
    const off = bootSkip.onSkip(done);
    hero.addEventListener("transitionend", done, { once: true });
  });

  hero.style.transition = "";
  hero.style.transform = "";
}

// Reveals `elements` one at a time (fade + slide up) rather than all at
// once - shared by the nav tabs and the competences groups.
async function staggerFadeReveal(elements, { step = 80, waitFn = wait } = {}) {
  if (prefersReducedMotion() || elements.length === 0) return;

  elements.forEach((el) => {
    el.style.transition = "none";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
  });

  await new Promise((resolve) => requestAnimationFrame(resolve));

  elements.forEach((el) => {
    el.style.transition = "opacity 0.3s ease, transform 0.3s ease";
  });

  for (const el of elements) {
    el.style.opacity = "";
    el.style.transform = "";
    await waitFn(step);
  }

  await waitFn(200);

  elements.forEach((el) => {
    el.style.transition = "";
  });
}

// Reveals the nav tabs one at a time rather than all at once.
async function revealNavTabs(nav) {
  if (isBootInstant()) return;
  await staggerFadeReveal([...nav.querySelectorAll(".tab")], { waitFn: bootWait });
}

// Scrambles the COMPÉTENCES heading in, then fades the group labels and
// stack tags in one at a time, in reading order.
function revealCompetences(section) {
  if (prefersReducedMotion()) return () => {};

  const heading = section.querySelector("h2");
  const items = [...section.querySelectorAll(".stack-group h3, .stack-tag")];
  let cancelled = false;
  let cancelHeading = null;

  // hidden immediately so items don't flash at full opacity while the
  // heading is still scrambling in
  items.forEach((item) => {
    item.style.transition = "none";
    item.style.opacity = "0";
  });

  (async () => {
    if (heading) {
      const { cancel, promise } = scrambleReveal(heading, heading.textContent);
      cancelHeading = cancel;
      await promise;
      if (cancelled) return;
    }
    if (cancelled) return;
    await staggerFadeReveal(items, { step: 40 });
  })();

  return () => {
    cancelled = true;
    if (cancelHeading) cancelHeading();
  };
}

let cancelReveal = null;

function renderPanel(route, panelsWrap, prompt) {
  if (cancelReveal) cancelReveal();

  const renderSection = SECTION_RENDERERS[route] || renderProfil;
  const section = renderSection();
  panelsWrap.replaceChildren(section, prompt);

  cancelReveal = route === "competences" ? revealCompetences(section) : animateReveal(section);

  const heading = section.querySelector("h2");
  if (heading) heading.focus();

  document.title = `${content.hero.name} — ${ROUTE_LABELS[route]}`;
}

function showSkipHint(inner) {
  const hint = document.createElement("p");
  hint.className = "boot-skip-hint";
  hint.textContent = "[ APPUYEZ SUR UNE TOUCHE POUR PASSER ]";
  inner.appendChild(hint);
  return hint;
}

async function boot(inner, panelsWrap, prompt) {
  if (readBootSeen()) bootSkip.trigger();

  const onInput = (event) => {
    // modifier-only presses (e.g. alt-tabbing away) aren't a skip request
    if (event.type === "keydown" && ["Alt", "Control", "Meta", "Shift"].includes(event.key)) return;
    bootSkip.trigger();
  };
  window.addEventListener("keydown", onInput);
  window.addEventListener("pointerdown", onInput);
  const hint = isBootInstant() ? null : showSkipHint(inner);

  try {
    await runPreloader(inner);

    const heroRefs = buildHero();
    await revealHero(inner, heroRefs);

    hint?.remove();

    const currentRoute = getCurrentRoute();
    const nav = renderNav(currentRoute);
    inner.append(nav, panelsWrap);
    await revealNavTabs(nav);

    renderPanel(currentRoute, panelsWrap, prompt);
    return { nav, currentRoute };
  } finally {
    hint?.remove();
    window.removeEventListener("keydown", onInput);
    window.removeEventListener("pointerdown", onInput);
    markBootSeen();
  }
}

// Number keys 1-5 jump straight to the matching section.
function bindShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (!/^[1-9]$/.test(event.key)) return;
    const route = ROUTES[Number(event.key) - 1];
    if (route) navigateTo(route);
  });
}

async function init() {
  const { inner, panelsWrap, transitionCanvas } = buildShell();
  const transition = new SectionTransition(transitionCanvas);
  const prompt = buildPrompt();

  let { nav, currentRoute } = await boot(inner, panelsWrap, prompt);

  // Route changes are serialized: a click landing mid-transition is queued
  // (only the latest one is kept) instead of starting a second, overlapping
  // transition that would swap panels twice.
  let pendingRoute = null;
  let switching = false;

  async function switchTo(route) {
    pendingRoute = route;
    if (switching) return;
    switching = true;

    while (pendingRoute && pendingRoute !== currentRoute) {
      const next = pendingRoute;
      pendingRoute = null;
      currentRoute = next;
      setActiveTab(nav, next);

      if (prefersReducedMotion()) {
        renderPanel(next, panelsWrap, prompt);
      } else {
        await transition.play(() => renderPanel(next, panelsWrap, prompt));
      }
    }

    pendingRoute = null;
    switching = false;
  }

  onRouteChange(switchTo);
  bindShortcuts();

  // the hash may have changed (back/forward) while the boot was playing
  if (getCurrentRoute() !== currentRoute) switchTo(getCurrentRoute());
}

init();
