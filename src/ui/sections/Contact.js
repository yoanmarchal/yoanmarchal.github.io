import { content } from "../../data/content.js";

export function renderContact() {
  const section = document.createElement("section");
  section.id = "panel-contact";
  section.className = "panel";
  section.setAttribute("role", "tabpanel");
  section.setAttribute("aria-labelledby", "tab-contact");

  section.innerHTML = `
    <h2 tabindex="-1">CONTACT</h2>
    <p class="meta">${content.contact.address}</p>
    <p class="contact-email"></p>
  `;

  const { user, domain } = content.contact.email;
  const link = document.createElement("a");
  link.href = ["mailto:", user, "@", domain].join("");
  link.textContent = [user, "@", domain].join("");
  link.rel = "nofollow";
  section.querySelector(".contact-email").appendChild(link);

  return section;
}
