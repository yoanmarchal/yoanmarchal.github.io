import { content } from "../../data/content.js";

export function renderCompetences() {
  const section = document.createElement("section");
  section.id = "panel-competences";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-competences");

  const rows = content.competences
    .map(
      (skill) => `
      <li style="--level: ${skill.level}%">
        <span class="stat-label">${skill.label}</span>
        <span class="stat-bar" aria-hidden="true"></span>
      </li>`
    )
    .join("");

  section.innerHTML = `
    <h2 tabindex="-1">COMPÉTENCES</h2>
    <ul class="stat-bars">${rows}</ul>
  `;

  return section;
}
