import "./ui/screenFrame.css";
import { content } from "./data/content.js";
import { renderNav, setActiveTab } from "./ui/Nav.js";
import { renderAccueil } from "./ui/sections/Accueil.js";
import { renderProfil } from "./ui/sections/Profil.js";
import { renderCompetences } from "./ui/sections/Competences.js";
import { renderExperience } from "./ui/sections/Experience.js";
import { renderProjets } from "./ui/sections/Projets.js";
import { renderContact } from "./ui/sections/Contact.js";
import { getCurrentRoute, navigateTo, onRouteChange } from "./router.js";
import { SectionTransition } from "./scene/SectionTransition.js";
import { animateReveal } from "./ui/scrambleReveal.js";

const SECTION_RENDERERS = {
  accueil: renderAccueil,
  profil: renderProfil,
  competences: renderCompetences,
  experience: renderExperience,
  projets: renderProjets,
  contact: renderContact,
};

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

  const inner = document.createElement("div");
  inner.className = "screen-inner";

  const hero = document.createElement("header");
  hero.className = "hero";
  hero.innerHTML = `
    <img class="logo" src="${import.meta.env.BASE_URL}images/yoanmarchal-logo.png" alt="" />
    <div>
      <h1>${content.hero.name.toUpperCase()}</h1>
      <p class="tagline">${content.hero.title.toUpperCase()} // ${content.hero.location.toUpperCase()}</p>
    </div>
  `;

  const panelsWrap = document.createElement("div");
  panelsWrap.className = "panels";

  inner.append(hero);
  crtScreen.append(crtOverlay, transitionCanvas, crtFlicker, crtGlass, inner);
  app.append(crtScreen);

  return { inner, panelsWrap, transitionCanvas };
}

let cancelReveal = null;

function renderPanel(route, panelsWrap) {
  if (cancelReveal) cancelReveal();

  panelsWrap.innerHTML = "";
  const renderSection = SECTION_RENDERERS[route] || renderAccueil;
  const section = renderSection();
  panelsWrap.appendChild(section);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    section.querySelectorAll(".stat-bar").forEach((bar) => {
      bar.classList.add("is-visible", "is-filled");
    });
  }

  cancelReveal = animateReveal(section, {
    onLineStart: (el) => {
      if (!el.classList.contains("stat-label")) return;
      el.closest("li")?.querySelector(".stat-bar")?.classList.add("is-visible");
    },
    onLineSettle: (el) => {
      if (!el.classList.contains("stat-label")) return;
      el.closest("li")?.querySelector(".stat-bar")?.classList.add("is-filled");
    },
  });

  const heading = section.querySelector("h2");
  if (heading) heading.focus();

  const label = route.charAt(0).toUpperCase() + route.slice(1);
  document.title = `${content.hero.name} — ${label}`;
}

function init() {
  const { inner, panelsWrap, transitionCanvas } = buildShell();
  const transition = new SectionTransition(transitionCanvas);

  let currentRoute = getCurrentRoute();

  const nav = renderNav(currentRoute, (route) => navigateTo(route));

  inner.append(nav, panelsWrap);
  renderPanel(currentRoute, panelsWrap);

  onRouteChange(async (route) => {
    if (route === currentRoute) return;
    currentRoute = route;
    setActiveTab(nav, route);

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReducedMotion) {
      renderPanel(route, panelsWrap);
      return;
    }

    await transition.play(() => renderPanel(route, panelsWrap));
  });
}

init();
