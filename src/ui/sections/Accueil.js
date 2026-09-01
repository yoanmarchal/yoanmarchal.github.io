import { content } from "../../data/content.js";

export function renderAccueil() {
  const section = document.createElement("section");
  section.id = "panel-accueil";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-accueil");

  section.innerHTML = content.accueil.bootLines
    .map((line) => `<p class="boot-line">&gt; ${line}</p>`)
    .join("");

  return section;
}
