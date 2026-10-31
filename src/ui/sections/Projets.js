import { content } from "../../data/content.js";
import { escapeHtml } from "../escapeHtml.js";

export function renderProjets() {
  const section = document.createElement("section");
  section.id = "panel-projets";
  section.className = "panel";

  // `ls -l`-style columns: year, name, type
  const items = content.projets.list
    .map(
      (projet) => `
      <li data-warp-border>
        <span class="projets-year">${escapeHtml(projet.year || "----")}</span>
        <span class="projets-name">${escapeHtml(projet.name)}</span>
        <span class="projets-meta">${escapeHtml(projet.type)}</span>
      </li>`
    )
    .join("");

  section.innerHTML = `
    <h2 tabindex="-1">PROJETS</h2>
    <p class="placeholder-note" data-warp-border>${escapeHtml(content.projets.note)}</p>
    <ul class="projets-list">${items}</ul>
  `;

  return section;
}
