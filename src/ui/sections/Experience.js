import { content } from "../../data/content.js";
import { escapeHtml } from "../escapeHtml.js";

export function renderExperience() {
  const section = document.createElement("section");
  section.id = "panel-experience";
  section.className = "panel";

  const entries = content.experience
    .map(
      (job) => `
      <article>
        <h3>${escapeHtml(job.role)} — ${escapeHtml(job.company)}</h3>
        <p class="meta">${escapeHtml(job.meta)}</p>
      </article>`
    )
    .join("");

  section.innerHTML = `
    <h2 tabindex="-1">EXPÉRIENCE</h2>
    ${entries}
  `;

  return section;
}
