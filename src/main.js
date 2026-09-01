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
  hero.innerHTML = `
    <img class="logo" src="${import.meta.env.BASE_URL}images/yoanmarchal-logo.png" alt="" />
    <div>
      <h1>${content.hero.name.toUpperCase()}</h1>
      <p class="tagline">${content.hero.title.toUpperCase()} // ${content.hero.location.toUpperCase()}</p>
    </div>
  `;
  return hero;
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

// Reveals the hero centered, then FLIP-animates it up to its normal
// in-flow position at the top of the screen once the nav/panels are
// about to appear alongside it.
async function revealHero(inner, hero) {
  inner.appendChild(hero);

  if (prefersReducedMotion()) {
    inner.classList.remove("is-centering");
    return;
  }

  hero.classList.add("hero--enter");
  await wait(30);
  hero.classList.remove("hero--enter");
  await wait(1800);

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

// Reveals the nav tabs one at a time rather than all at once.
async function revealNavTabs(nav) {
  const tabs = [...nav.querySelectorAll(".tab")];
  if (prefersReducedMotion()) return;

  tabs.forEach((tab) => {
    tab.style.transition = "none";
    tab.style.opacity = "0";
    tab.style.transform = "translateY(6px)";
  });

  await new Promise((resolve) => requestAnimationFrame(resolve));

  tabs.forEach((tab) => {
    tab.style.transition = "opacity 0.3s ease, transform 0.3s ease";
  });

  for (const tab of tabs) {
    tab.style.opacity = "";
    tab.style.transform = "";
    await wait(110);
  }

  await wait(200);

  tabs.forEach((tab) => {
    tab.style.transition = "";
  });
}

let cancelReveal = null;

function renderPanel(route, panelsWrap) {
  if (cancelReveal) cancelReveal();

  panelsWrap.innerHTML = "";
  const renderSection = SECTION_RENDERERS[route] || renderProfil;
  const section = renderSection();
  panelsWrap.appendChild(section);

  cancelReveal = animateReveal(section);

  const heading = section.querySelector("h2");
  if (heading) heading.focus();

  const label = route.charAt(0).toUpperCase() + route.slice(1);
  document.title = `${content.hero.name} — ${label}`;
}

async function boot(inner, panelsWrap) {
  await runPreloader(inner);

  const hero = buildHero();
  await revealHero(inner, hero);
  await revealHeroBorder(hero);

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
