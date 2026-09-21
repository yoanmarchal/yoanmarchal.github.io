import { content } from "../../data/content.js";

export function renderProjets() {
  const section = document.createElement("section");
  section.id = "panel-projets";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-projets");

  const items = content.projets.list
    .map(
      (projet) => `
      <li>
        <span class="projets-name">${projet.name}</span>
        <span class="projets-meta">${projet.year ? `${projet.type} · ${projet.year}` : projet.type}</span>
      </li>`
    )
    .join("");

  section.innerHTML = `
    <h2 tabindex="-1">PROJETS</h2>
    <p class="placeholder-note">${content.projets.note}</p>
    <ul class="projets-list">${items}</ul>
  `;

  return section;
}
