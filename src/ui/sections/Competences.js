import { content } from "../../data/content.js";
import { escapeHtml } from "../escapeHtml.js";

export function renderCompetences() {
  const section = document.createElement("section");
  section.id = "panel-competences";
  section.className = "panel";

  // labels uppercased in JS, not via CSS text-transform - TextWarpLayer
  // draws each leaf's textContent, so a CSS-only transform wouldn't show
  const groups = content.competences
    .map(
      (group) => `
      <div class="stack-group">
        <h3>${escapeHtml(group.label.toUpperCase())}</h3>
        <ul class="stack-list">
          ${group.items.map((tech) => `<li class="stack-tag">${escapeHtml(tech)}</li>`).join("")}
        </ul>
      </div>`
    )
    .join("");

  section.innerHTML = `
    <h2 tabindex="-1">COMPÉTENCES</h2>
    <div class="stack-groups">${groups}</div>
  `;

  return section;
}
