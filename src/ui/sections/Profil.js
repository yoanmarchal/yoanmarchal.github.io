import { content } from "../../data/content.js";
import { escapeHtml } from "../escapeHtml.js";

export function renderProfil() {
  const section = document.createElement("section");
  section.id = "panel-profil";
  section.className = "panel";

  section.innerHTML = `
    <h2 tabindex="-1">PROFIL</h2>
    <p>${escapeHtml(content.profil.text)}</p>
  `;

  return section;
}
