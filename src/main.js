import "./ui/screenFrame.css";
import { content } from "./data/content.js";
import { renderNav, setActiveTab } from "./ui/Nav.js";
import { renderProfil } from "./ui/sections/Profil.js";
import { renderCompetences } from "./ui/sections/Competences.js";
import { renderExperience } from "./ui/sections/Experience.js";
import { renderProjets } from "./ui/sections/Projets.js";
import { renderContact } from "./ui/sections/Contact.js";
import { getCurrentRoute, navigateTo, onRouteChange } from "./router.js";
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  const textWarp = new TextWarpLayer(textWarpCanvas, inner);
  if (textWarp.supported) inner.classList.add("crt-warp-active");

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

  return { hero, logo, name, job, location };
}

async function runPreloader(inner) {
  const preloader = document.createElement("div");
  preloader.className = "preloader";
  inner.appendChild(preloader);

  for (const line of content.preloader.lines) {
    const p = document.createElement("p");
    p.className = "boot-line";
    preloader.appendChild(p);

    const text = `> ${line}`;
    if (prefersReducedMotion()) {
      p.textContent = text;
    } else {
      const { promise } = scrambleReveal(p, text);
      await promise;
      await wait(150);
    }
  }

  await wait(prefersReducedMotion() ? 0 : 450);
  preloader.remove();
}

// Reveals the hero centered - logo, then name, job title and location one
// at a time - then FLIP-animates it up to its normal in-flow position at
// the top of the screen once the nav/panels are about to appear alongside
// it.
async function revealHero(inner, heroRefs) {
  const { hero, logo, name, job, location } = heroRefs;
  inner.appendChild(hero);

  if (prefersReducedMotion()) {
    name.textContent = content.hero.name.toUpperCase();
    job.textContent = content.hero.title.toUpperCase();
    location.textContent = content.hero.location.toUpperCase();
    inner.classList.remove("is-centering");
    return;
  }

  logo.classList.add("logo--enter");
  await wait(30);
  logo.classList.remove("logo--enter");
  await wait(300);

  await scrambleReveal(name, content.hero.name.toUpperCase()).promise;
  await wait(120);

  await scrambleReveal(job, content.hero.title.toUpperCase()).promise;
  await wait(120);

  const sep = hero.querySelector(".tagline-sep");
  sep.classList.add("is-visible");
  await wait(150);

  await scrambleReveal(location, content.hero.location.toUpperCase()).promise;
  await wait(600);

  const firstRect = hero.getBoundingClientRect();
  inner.classList.remove("is-centering");
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
    hero.addEventListener("transitionend", resolve, { once: true });
  });

  hero.style.transition = "";
  hero.style.transform = "";
}

// Draws the hero's bottom border in left-to-right, once it has settled
// into place.
async function revealHeroBorder(hero) {
  hero.classList.add("hero--border-in");
  if (prefersReducedMotion()) return;
  await wait(650);
}

// Reveals `elements` one at a time (fade + slide up) rather than all at
// once - shared by the nav tabs and the competences stack tags.
async function staggerFadeReveal(elements) {
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
    await wait(110);
  }

  await wait(200);

  elements.forEach((el) => {
    el.style.transition = "";
  });
}

// Reveals the nav tabs one at a time rather than all at once.
async function revealNavTabs(nav) {
  await staggerFadeReveal([...nav.querySelectorAll(".tab")]);
}

// Scrambles the COMPÉTENCES heading in, then reveals the stack tags one
// at a time with the same entrance as the nav tabs.
function revealCompetences(section) {
  if (prefersReducedMotion()) return () => {};

  const heading = section.querySelector("h2");
  const tags = [...section.querySelectorAll(".stack-tag")];
  let cancelled = false;
  let cancelHeading = null;

  // hidden immediately so tags don't flash at full opacity while the
  // heading is still scrambling in
  tags.forEach((tag) => {
    tag.style.transition = "none";
    tag.style.opacity = "0";
  });

  (async () => {
    if (heading) {
      const { cancel, promise } = scrambleReveal(heading, heading.textContent);
      cancelHeading = cancel;
      await promise;
      if (cancelled) return;
      await wait(150);
    }
    if (cancelled) return;
    await staggerFadeReveal(tags);
  })();

  return () => {
    cancelled = true;
    if (cancelHeading) cancelHeading();
  };
}

let cancelReveal = null;

function renderPanel(route, panelsWrap) {
  if (cancelReveal) cancelReveal();

  panelsWrap.innerHTML = "";
  const renderSection = SECTION_RENDERERS[route] || renderProfil;
  const section = renderSection();
  panelsWrap.appendChild(section);

  cancelReveal = route === "competences" ? revealCompetences(section) : animateReveal(section);

  const heading = section.querySelector("h2");
  if (heading) heading.focus();

  const label = route.charAt(0).toUpperCase() + route.slice(1);
  document.title = `${content.hero.name} — ${label}`;
}

async function boot(inner, panelsWrap) {
  await runPreloader(inner);

  const heroRefs = buildHero();
  await revealHero(inner, heroRefs);
  await revealHeroBorder(heroRefs.hero);

  const currentRoute = getCurrentRoute();
  const nav = renderNav(currentRoute, (route) => navigateTo(route));
  inner.append(nav, panelsWrap);
  await revealNavTabs(nav);

  renderPanel(currentRoute, panelsWrap);

  return { nav, currentRoute };
}

async function init() {
  const { inner, panelsWrap, transitionCanvas } = buildShell();
  const transition = new SectionTransition(transitionCanvas);

  let { nav, currentRoute } = await boot(inner, panelsWrap);

  onRouteChange(async (route) => {
    if (route === currentRoute) return;
    currentRoute = route;
    setActiveTab(nav, route);

    if (prefersReducedMotion()) {
      renderPanel(route, panelsWrap);
      return;
    }

    await transition.play(() => renderPanel(route, panelsWrap));
  });
}

init();
