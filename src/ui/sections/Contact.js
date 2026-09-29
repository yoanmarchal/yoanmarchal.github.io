import { content } from "../../data/content.js";
import { escapeHtml } from "../escapeHtml.js";

const COPY_LABEL = "[ COPIER ]";
const FEEDBACK_MS = 2000;

export function renderContact() {
  const section = document.createElement("section");
  section.id = "panel-contact";
  section.className = "panel";

  const links = content.contact.links
    .map(
      (link) =>
        `<li><a href="${escapeHtml(link.href)}" target="_blank" rel="noopener me">${escapeHtml(link.label)}</a></li>`
    )
    .join("");

  section.innerHTML = `
    <h2 tabindex="-1">CONTACT</h2>
    <p class="meta">${escapeHtml(content.contact.address)}</p>
    <p class="contact-email"></p>
    <ul class="contact-links">${links}</ul>
    <p class="sr-only" aria-live="polite"></p>
  `;

  const { user, domain } = content.contact.email;
  const address = [user, "@", domain].join("");

  const link = document.createElement("a");
  link.href = `mailto:${address}`;
  link.textContent = address;
  link.rel = "nofollow";

  // the screen blocks text selection (the visible text is a warped canvas
  // copy), so copying the address needs its own control
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "copy-email";
  copyButton.textContent = COPY_LABEL;
  copyButton.setAttribute("aria-label", "Copier l'adresse e-mail");

  const status = section.querySelector("[aria-live]");
  let resetTimer;

  copyButton.addEventListener("click", async () => {
    let label = "[ COPIÉ ]";
    let message = "Adresse e-mail copiée";
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      label = "[ ÉCHEC ]";
      message = "Impossible de copier l'adresse e-mail";
    }

    copyButton.textContent = label;
    status.textContent = message;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copyButton.textContent = COPY_LABEL;
      status.textContent = "";
    }, FEEDBACK_MS);
  });

  section.querySelector(".contact-email").append(link, copyButton);

  return section;
}
