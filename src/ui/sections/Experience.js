import { content } from "../../data/content.js";

export function renderExperience() {
  const section = document.createElement("section");
  section.id = "panel-experience";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-experience");

  const entries = content.experience
    .map(
      (job) => `
      <article>
        <h3>${job.role} — ${job.company}</h3>
        <p class="meta">${job.meta}</p>
      </article>`
    )
    .join("");

  section.innerHTML = `
    <h2 tabindex="-1">EXPÉRIENCE</h2>
    ${entries}
  `;

  return section;
}
