import { ROUTES } from "../router.js";

const LABELS = {
  accueil: "ACCUEIL",
  profil: "PROFIL",
  competences: "COMPÉTENCES",
  experience: "EXPÉRIENCE",
  projets: "PROJETS",
  contact: "CONTACT",
};

export function renderNav(activeRoute, onSelect) {
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.setAttribute("role", "tablist");

  ROUTES.forEach((route) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `tab-${route}`;
    btn.className = "tab";
    btn.textContent = `[ ${LABELS[route]} ]`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", `panel-${route}`);
    btn.setAttribute("aria-selected", String(route === activeRoute));
    if (route === activeRoute) btn.classList.add("is-active");
    btn.addEventListener("click", () => onSelect(route));
    nav.appendChild(btn);
  });

  return nav;
}

export function setActiveTab(nav, route) {
  nav.querySelectorAll(".tab").forEach((btn) => {
    const isActive = btn.id === `tab-${route}`;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
}
