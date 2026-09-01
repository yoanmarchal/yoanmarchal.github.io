export const ROUTES = [
  "accueil",
  "profil",
  "competences",
  "experience",
  "projets",
  "contact",
];

const DEFAULT_ROUTE = "accueil";

export function getCurrentRoute() {
  const hash = location.hash.replace("#", "");
  return ROUTES.includes(hash) ? hash : DEFAULT_ROUTE;
}

export function navigateTo(route) {
  if (!ROUTES.includes(route)) return;
  if (location.hash.replace("#", "") === route) return;
  location.hash = route;
}

export function onRouteChange(callback) {
  window.addEventListener("hashchange", () => callback(getCurrentRoute()));
}
