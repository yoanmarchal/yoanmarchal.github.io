# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Yoan Marchal's personal portfolio site (`yoanmarchal.github.io`), styled as a single bulging CRT terminal screen. Vanilla JS + Three.js, no UI framework, no build-time templating — DOM is built by hand in JS.

## Commands

```bash
npm run dev       # Vite dev server
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

There is no lint script and no test suite configured in this repo.

## Architecture

**Entry point / boot sequence** — `src/main.js` builds the entire DOM shell in code (no HTML templates beyond the `index.html` skeleton) and runs a scripted, sequential async boot: preloader lines → hero reveal (logo/name/tagline, FLIP-animated from centered to its in-flow position) → nav tabs → first panel. Every step is skippable via `prefers-reduced-motion`.

**Content** — `src/data/content.js` is the single source of truth for all displayed text (hero, preloader lines, per-section copy). Section renderers pull from it rather than hardcoding strings.

**Routing** — `src/router.js` is a minimal hash router (`#profil`, `#competences`, `#experience`, `#projets`, `#contact`; `ROUTES` array + `DEFAULT_ROUTE`). `main.js` maps each route to a `renderXxx()` function (`SECTION_RENDERERS`) from `src/ui/sections/*.js`; each returns a plain DOM `<section>`. Route changes swap the panel content at the midpoint of the `SectionTransition` WebGL glitch effect.

**CRT screen effect (`src/ui/screenFrame.css` + `index.html`)** — The whole UI lives inside `.crt-screen`, filling the viewport edge-to-edge and clipped to a bulging-tube shape via the shared `#crtClip` SVG `clipPath` defined once in `index.html` and referenced from multiple CSS layers (`.crt-screen`, `.screen-inner`, `.text-warp-canvas`) so the curvature is consistent everywhere. Additional `.crt-overlay`/`.crt-glass`/`.crt-flicker` layers add scanlines, vignette, glass reflection and a one-shot power-on flicker. Root `font-size` is bumped 125% (dialed back to 100% under `max-width: 640px`) so everything sized in `rem` scales together — keep new sizing in `rem`, not `px`, unless it's an effect radius (shadows, borders) that shouldn't scale with text.

**Two Three.js layers, each a full-screen orthographic quad + custom GLSL** (`src/shaders/`):
- `TextWarpLayer` (`src/scene/TextWarpLayer.js`) — every frame, mirrors the real DOM text of `.screen-inner` onto an offscreen 2D canvas (walking leaf text nodes, re-measuring `getBoundingClientRect`/`getComputedStyle`), uploads it as a texture, and renders it through `textWarp.frag/vert.glsl`'s barrel-distortion shader so visible text follows the same CRT curvature as the glass. The real DOM text stays in place (focusable, selectable, screen-reader-visible) but is made invisible via `-webkit-text-fill-color: transparent` on `.crt-warp-active`; interactive elements get a compensating `transform` so their hit-box lines up with the warped visual glyphs.
- `SectionTransition` (`src/scene/SectionTransition.js`) — plays a ~550ms scanline/glitch shader (`transition.frag/vert.glsl`) on route change; `play(onMidpoint)` calls back at 50% progress, which is when `main.js` actually swaps the panel DOM underneath the effect.

**Terminal text reveal** — `src/ui/scrambleReveal.js` implements the "decrypt" character-scramble effect (random glyphs settling into real characters) used by the boot preloader and by `animateReveal`, which sequentially reveals a section's heading/paragraph leaves. Also used for the nav tabs' stagger-fade-in.

**Sections** (`src/ui/sections/*.js`) — small, mostly declarative `renderXxx()` functions building one `<section class="panel">` each from `content.js`; follow the existing files' shape (e.g. `Profil.js`, `Contact.js`) for new ones.

## Notes for changes

- Accessibility is load-bearing here, not incidental: the invisible real DOM text, `aria-label`s set by `scrambleReveal`, and the `prefers-reduced-motion` branches throughout `main.js`/`scrambleReveal.js` are intentional — don't strip them out when touching the reveal/warp code paths.
- `TextWarpLayer` and `SectionTransition` each own a `requestAnimationFrame` loop and re-measure the DOM every frame rather than caching layout, so most content/CSS changes "just work" without extra wiring — but any new interactive element inside `.screen-inner` needs to be a real, focusable DOM node for the hit-box compensation in `TextWarpLayer._drawMirror` to pick it up.
