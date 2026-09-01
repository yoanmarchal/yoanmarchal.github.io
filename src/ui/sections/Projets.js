import { content } from "../../data/content.js";

export function renderProjets() {
  const section = document.createElement("section");
  section.id = "panel-projets";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-projets");

  section.innerHTML = `
    <h2 tabindex="-1">PROJETS</h2>
    <p class="placeholder-note">${content.projets.note}</p>
  `;

  return section;
}
