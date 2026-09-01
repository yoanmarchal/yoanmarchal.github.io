import { content } from "../../data/content.js";

export function renderCompetences() {
  const section = document.createElement("section");
  section.id = "panel-competences";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-competences");

  const items = content.competences
    .map((tech) => `<li class="stack-tag">${tech}</li>`)
    .join("");

  section.innerHTML = `
    <h2 tabindex="-1">COMPÉTENCES</h2>
    <ul class="stack-list">${items}</ul>
  `;

  return section;
}
