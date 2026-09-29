import { ROUTES, ROUTE_LABELS } from "../router.js";

// Plain in-page links rather than an ARIA tablist: the sections behave like
// pages (own URL hash, back/forward, middle-click, crawlable), and links
// need no custom arrow-key handling to be fully keyboard accessible.
export function renderNav(activeRoute) {
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.setAttribute("aria-label", "Sections");

  ROUTES.forEach((route, index) => {
    const shortcut = String(index + 1);

    const link = document.createElement("a");
    link.href = `#${route}`;
    link.className = "tab";
    link.dataset.route = route;
    link.setAttribute("aria-keyshortcuts", shortcut);

    // separate leaf elements (TextWarpLayer only mirrors element leaves,
    // not loose text nodes) - the key hint is hidden on touch screens
    const key = document.createElement("span");
    key.className = "tab-key";
    key.setAttribute("aria-hidden", "true");
    key.textContent = `[${shortcut}]`;

    const label = document.createElement("span");
    label.textContent = ROUTE_LABELS[route].toUpperCase();

    link.append(key, label);
    nav.appendChild(link);
  });

  setActiveTab(nav, activeRoute);
  return nav;
}

export function setActiveTab(nav, route) {
  nav.querySelectorAll(".tab").forEach((link) => {
    const isActive = link.dataset.route === route;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}
