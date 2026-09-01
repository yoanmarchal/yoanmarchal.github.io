import { content } from "../../data/content.js";

export function renderContact() {
  const section = document.createElement("section");
  section.id = "panel-contact";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-contact");

  section.innerHTML = `
    <h2 tabindex="-1">CONTACT</h2>
    <p class="placeholder-note">${content.contact.note}</p>
  `;

  return section;
}
