import { content } from "../../data/content.js";
import { escapeHtml } from "../escapeHtml.js";

export function renderProjets() {
  const section = document.createElement("section");
  section.id = "panel-projets";
  section.className = "panel";

  const apps = content.projets.apps
    .map(
      (app) => `
      <li data-warp-border>
        <span class="projets-year">${escapeHtml(app.year)}</span>
        <span class="projets-name">${escapeHtml(app.name)}</span>
        <span class="projets-meta">${escapeHtml(app.type)}</span>
        <p class="projets-desc">${escapeHtml(app.description)}</p>
        ${
          app.links.length
            ? `<p class="projets-links">
          ${app.links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`).join("")}
        </p>`
            : ""
        }
      </li>`
    )
    .join("");

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
    <h3 class="projets-heading">APPLICATIONS PERSONNELLES</h3>
    <ul class="projets-list">${apps}</ul>
    <h3 class="projets-heading">PROJETS CLIENTS</h3>
    <p class="placeholder-note" data-warp-border>${escapeHtml(content.projets.note)}</p>
    <ul class="projets-list">${items}</ul>
  `;

  return section;
}
