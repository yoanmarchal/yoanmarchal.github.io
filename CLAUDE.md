# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Yoan Marchal's personal portfolio site (`yoanmarchal.github.io`), styled as a single bulging CRT terminal screen. Vanilla JS + raw WebGL (no Three.js), no UI framework, no build-time templating — DOM is built by hand in JS.

## Commands

```bash
npm run dev       # Vite dev server
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

There is no lint script and no test suite configured in this repo.

## Architecture

**Entry point / boot sequence** — `src/main.js` builds the entire DOM shell in code (no HTML templates beyond the `index.html` skeleton) and runs a scripted, sequential async boot: preloader lines → hero reveal (logo/name/tagline, FLIP-animated from centered to its in-flow position) → nav tabs → first panel. Every step is instant under `prefers-reduced-motion`, and any key/click jumps to the end (`bootSkip` signal: steps use `bootWait`/`bootType`, which resolve early on skip).

**Content** — `src/data/content.js` is the single source of truth for all displayed text (hero, preloader lines, per-section copy). Section renderers pull from it rather than hardcoding strings.

**Routing** — `src/router.js` is a minimal hash router (`#profil`, `#competences`, `#experience`, `#projets`, `#contact`; `ROUTES` array + `DEFAULT_ROUTE`). Route labels live in `ROUTE_LABELS` (router.js). The nav is plain `<a href="#route">` links with `aria-current="page"` (not an ARIA tablist); number keys 1–5 jump to sections. `main.js` maps each route to a `renderXxx()` function (`SECTION_RENDERERS`) from `src/ui/sections/*.js`; each returns a plain DOM `<section>`. Route changes swap the panel content at the midpoint of the `SectionTransition` WebGL glitch effect; changes arriving mid-transition are queued (latest wins) rather than overlapping.

**CRT screen effect (`src/ui/screenFrame.css` + `index.html`)** — The whole UI lives inside `.crt-screen`, filling the viewport edge-to-edge and clipped to a bulging-tube shape via the shared `#crtClip` SVG `clipPath` defined once in `index.html` and referenced from multiple CSS layers (`.crt-screen`, `.screen-inner`, `.text-warp-canvas`) so the curvature is consistent everywhere. Additional `.crt-overlay`/`.crt-glass`/`.crt-flicker` layers add scanlines, vignette, glass reflection and a one-shot power-on flicker. Root `font-size` is bumped 125% (dialed back to 100% under `max-width: 640px`) so everything sized in `rem` scales together — keep new sizing in `rem`, not `px`, unless it's an effect radius (shadows, borders) that shouldn't scale with text.

**Two WebGL layers, each a full-screen quad + custom GLSL** (`src/shaders/`, shared `quad.vert.glsl`; tiny program/quad helpers in `src/scene/gl.js`):
- `TextWarpLayer` (`src/scene/TextWarpLayer.js`) — mirrors the real DOM text of `.screen-inner` onto an offscreen 2D canvas (walking leaf elements, measuring `getBoundingClientRect`/`getComputedStyle`; wrapped text uses `Range` line boxes; opacity is multiplied up the ancestor chain), uploads it as a texture, and renders it through `textWarp.frag.glsl`'s barrel-distortion shader so visible text follows the same CRT curvature as the glass. It renders **on demand**, not every frame: DOM mutations, CSS transitions (`transitionrun`→`transitionend`), scroll, focus, resize and image/font loads schedule a redraw. The real DOM text stays in place (focusable, screen-reader-visible) but is made invisible via `-webkit-text-fill-color: transparent` under `.crt-warp-active`, a class the layer itself adds — and removes on WebGL context loss (then tries to rebuild on a fresh canvas), so text never disappears with the GPU. Interactive elements (`a`, `button`, which must be inline-block or block for it to apply) get a compensating `transform` so their hit-box lines up with the warped visual glyphs. Non-leaf elements with a visible border (e.g. the Projets note and row separators) opt in with `data-warp-border`: the layer draws their border into the mirror so it curves with the text, and CSS hides the real, straight one.
- `SectionTransition` (`src/scene/SectionTransition.js`) — plays a ~550ms scanline/glitch shader (`transition.frag/vert.glsl`) on route change; `play(onMidpoint)` calls back at 50% progress, which is when `main.js` actually swaps the panel DOM underneath the effect.

**Terminal text reveal** — `src/ui/scrambleReveal.js` implements the "decrypt" character-scramble effect (random glyphs settling into real characters, grouped per word in `nowrap` spans so lines wrap at spaces) used by the boot preloader and by `animateReveal`, which cascades a section's leaves within a fixed time `budget` so long sections don't take longer to appear. The real text is kept for assistive tech as a visually-hidden `.sr-only` sibling of the `aria-hidden` scramble spans (not `aria-label`, which is prohibited on `p`/`span`).

**Prompt** — `src/ui/Prompt.js` is the terminal command line under each section: a real `<input>` (opacity 0, labelled) whose value, block cursor and inline completion are re-drawn as spans beside it, since `TextWarpLayer` only mirrors element text, never an input's value. It completes route ids (accent-insensitive, `cd <route>` and digits accepted), shows the matches as buttons, and navigates on Enter. `main.js` hides it on each panel render and shows it from the reveal's `onComplete`, so it only appears once the section has finished printing; typing a letter anywhere focuses it, and the 1–5 shortcuts are ignored while a field has focus.

**Sections** (`src/ui/sections/*.js`) — small, mostly declarative `renderXxx()` functions building one `<section class="panel">` each from `content.js`; follow the existing files' shape (e.g. `Profil.js`, `Contact.js`) for new ones.

## Notes for changes

- Accessibility is load-bearing here, not incidental: the invisible real DOM text, the `.sr-only` copies set by `scrambleReveal`, and the `prefers-reduced-motion` branches throughout `main.js`/`scrambleReveal.js` are intentional — don't strip them out when touching the reveal/warp code paths.
- `TextWarpLayer` re-measures the DOM on every redraw rather than caching layout, so content/CSS changes "just work" as long as they surface as a DOM mutation or a CSS transition. An infinite CSS `animation` inside `.screen-inner` will NOT be redrawn — animate from JS (e.g. toggling a class, like the prompt cursor) instead. CSS `text-transform` isn't mirrored either (the canvas draws `textContent`): uppercase in JS. Any new interactive element inside `.screen-inner` needs to be a real, focusable `a`/`button`/`input` for the hit-box compensation in `TextWarpLayer._alignHitBoxes` to pick it up.
- `index.html` gets a JSON-LD `Person` block and a `<noscript>` content fallback generated from `content.js` at build time by the `static-content` plugin in `vite.config.js`.
