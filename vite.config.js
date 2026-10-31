import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";
import { content } from "./src/data/content.js";
import { escapeHtml } from "./src/ui/escapeHtml.js";

const SITE_URL = "https://yoanmarchal.github.io/";

// The live site is built entirely in JS, so crawlers that don't run it (and
// visitors without JS) would otherwise get an empty page. Both blocks below
// are generated from content.js at build time, so it stays the single source
// of truth.
function personJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: content.hero.name,
    jobTitle: "Développeur web",
    url: SITE_URL,
    homeLocation: { "@type": "Place", name: content.contact.address },
    knowsAbout: content.competences.flatMap((group) => group.items),
    sameAs: content.contact.links.map((link) => link.href),
  };
  // "<" escaped so the JSON can't close the <script> early
  const json = JSON.stringify(data).replace(/</g, "\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

function noscriptFallback() {
  const e = escapeHtml;
  const { hero, profil, competences, experience, projets, contact } = content;
  const { user, domain } = contact.email;

  return `<noscript>
    <main class="static-fallback">
      <h1>${e(hero.name)}</h1>
      <p>${e(hero.title)} — ${e(hero.location)}</p>
      <h2>Profil</h2>
      <p>${e(profil.text)}</p>
      <h2>Compétences</h2>
      <ul>${competences.map((g) => `<li>${e(g.label)} : ${g.items.map(e).join(", ")}</li>`).join("")}</ul>
      <h2>Expérience</h2>
      <ul>${experience.map((j) => `<li>${e(j.role)} — ${e(j.company)} (${e(j.meta)})</li>`).join("")}</ul>
      <h2>Projets</h2>
      <p>${e(projets.note)}</p>
      <ul>${projets.list.map((p) => `<li>${e(p.name)} — ${e(p.type)}${p.year ? ` (${e(p.year)})` : ""}</li>`).join("")}</ul>
      <h2>Contact</h2>
      <p>${e(contact.address)} · ${e(user)} [at] ${e(domain)}</p>
      <ul>${contact.links.map((l) => `<li><a href="${e(l.href)}">${e(l.label)}</a></li>`).join("")}</ul>
    </main>
  </noscript>`;
}

const NOSCRIPT_STYLE = `<noscript><style>
  body { display: block !important; overflow: auto !important; }
  .static-fallback { max-width: 44rem; margin: 0 auto; padding: 2rem 1rem; line-height: 1.5; }
  .static-fallback a { color: #ffb000; }
</style></noscript>`;

function staticContent() {
  return {
    name: "static-content",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace("<!-- static:head -->", `${personJsonLd()}\n  ${NOSCRIPT_STYLE}`)
          .replace("<!-- static:fallback -->", noscriptFallback());
      },
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [glsl(), staticContent()],
});
