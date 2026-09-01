import { content } from "../../data/content.js";

export function renderProfil() {
  const section = document.createElement("section");
  section.id = "panel-profil";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-profil");

  section.innerHTML = `
    <h2 tabindex="-1">PROFIL</h2>
    <p>${content.profil.text}</p>
  `;

  return section;
}
