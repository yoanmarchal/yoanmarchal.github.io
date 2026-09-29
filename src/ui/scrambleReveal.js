const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%&*<>/\\|+-=";

const NBSP = " ";

function randomGlyph() {
  return GLYPHS[(Math.random() * GLYPHS.length) | 0];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The real text, visually hidden but read by assistive tech in place of the
// aria-hidden scramble spans next to it. Used instead of aria-label, which
// is prohibited on generic/paragraph roles (span, div, p) and ignored by
// several screen readers there - a hidden text node works on any element.
export function createScreenReaderText(text) {
  const span = document.createElement("span");
  span.className = "sr-only";
  span.textContent = text;
  return span;
}

/**
 * Reveals `text` inside `el` character by character, each character
 * cycling through random glyphs before locking in - a "Matrix decrypt"
 * terminal effect. The real text stays available to assistive tech via a
 * visually-hidden copy immediately, independent of the animation.
 *
 * Options: `charDelay` (ms between characters starting), `scrambleDuration`
 * (ms each character scrambles), `maxDuration` (caps the whole line by
 * shrinking charDelay for long text).
 *
 * Returns { cancel, finish, promise } - promise resolves once every
 * character has settled (or finish() jumped straight to the end), so
 * callers can chain lines sequentially.
 */
export function scrambleReveal(el, text, options = {}) {
  const chars = [...text];
  const count = Math.max(chars.length, 1);
  const scrambleDuration = options.scrambleDuration ?? 200;
  let charDelay = options.charDelay ?? Math.max(4, Math.min(24, 900 / count));
  if (options.maxDuration) {
    charDelay = Math.min(charDelay, Math.max(0, options.maxDuration - scrambleDuration) / count);
  }

  const spans = chars.map((ch) => {
    if (ch === " ") return null;
    const span = document.createElement("span");
    // starts as NBSP regardless of the real character - the first
    // requestAnimationFrame callback below is what actually decides
    // each char's displayed state (hidden/scrambling/settled), but the
    // browser can paint once before that frame runs. Pre-filling with
    // the real character here made the full, unscrambled text flash
    // for a frame before the reveal took over.
    span.textContent = NBSP;
    span.className = "scramble-char";
    return span;
  });

  // Each character box is an atomic inline, and line breaking allows a
  // break next to any atomic inline - so a bare run of them wraps
  // mid-word. Grouping each word's boxes in a nowrap span, separated by
  // real (breakable) spaces, keeps wrapping at word boundaries.
  const wrapper = document.createElement("span");
  wrapper.setAttribute("aria-hidden", "true");
  let word = null;
  spans.forEach((span) => {
    if (!span) {
      wrapper.append(" ");
      word = null;
      return;
    }
    if (!word) {
      word = document.createElement("span");
      word.className = "scramble-word";
      wrapper.append(word);
    }
    word.append(span);
  });

  el.replaceChildren(createScreenReaderText(text), wrapper);

  const start = performance.now();
  let rafId;
  let resolveDone;
  const promise = new Promise((resolve) => {
    resolveDone = resolve;
  });

  function frame(now) {
    const elapsed = now - start;
    let allDone = true;

    chars.forEach((ch, i) => {
      if (ch === " ") return;
      const span = spans[i];
      const charElapsed = elapsed - i * charDelay;

      if (charElapsed < 0) {
        span.textContent = NBSP;
        span.classList.remove("is-scrambling");
        allDone = false;
      } else if (charElapsed < scrambleDuration) {
        span.textContent = randomGlyph();
        span.classList.add("is-scrambling");
        allDone = false;
      } else {
        span.textContent = ch;
        span.classList.remove("is-scrambling");
      }
    });

    if (!allDone) {
      rafId = requestAnimationFrame(frame);
    } else {
      resolveDone();
    }
  }

  rafId = requestAnimationFrame(frame);

  function finish() {
    cancelAnimationFrame(rafId);
    chars.forEach((ch, i) => {
      if (ch === " ") return;
      spans[i].textContent = ch;
      spans[i].classList.remove("is-scrambling");
    });
    resolveDone();
  }

  return { cancel: () => cancelAnimationFrame(rafId), finish, promise };
}

function collectLeafTextElements(root) {
  const result = [];
  (function walk(node) {
    if (node.classList?.contains("sr-only")) return;
    const children = [...node.children];
    if (children.length === 0) {
      if (node.textContent.trim().length > 0) result.push(node);
      return;
    }
    children.forEach(walk);
  })(root);
  return result;
}

/**
 * Walks a section's leaf text elements (headings, paragraphs, labels...)
 * and reveals each with scrambleReveal.
 *
 * Two modes:
 * - cascade (default): lines start `stagger` ms apart and overlap. The
 *   stagger is derived from `budget` (total ms for the whole section), so
 *   a long list like PROJETS takes about as long as a short one instead of
 *   growing linearly with its line count; each line is itself capped at
 *   `lineDuration` ms.
 * - sequential (sequential: true): each line fully settles, waits
 *   `linePause` ms, then the next line starts - reads like a real terminal
 *   printing a boot log, but only suits a handful of lines.
 *
 * Returns a cancel function.
 */
export function animateReveal(root, options = {}) {
  const {
    budget = 1400,
    lineDuration = 700,
    stagger,
    sequential = false,
    linePause = 150,
    onLineStart,
    onLineSettle,
    ...scrambleOptions
  } = options;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const leaves = collectLeafTextElements(root).map((el) => ({
    el,
    text: el.textContent,
  }));

  if (reduceMotion) return () => {};

  const lineStagger = stagger ?? Math.min(160, Math.max(12, budget / Math.max(leaves.length, 1)));

  leaves.forEach(({ el, text }) => {
    // the visible text goes, but a screen-reader copy stays so the content
    // is announced up-front rather than only once its line animates
    el.replaceChildren(createScreenReaderText(text));
    // stays collapsed (no reserved blank line) until this leaf's own
    // animation starts, so nothing shows up-front on load - lines appear
    // one at a time as a real terminal would print them
    el.classList.add("reveal-pending");
  });

  const startLine = (el, text) => {
    el.classList.remove("reveal-pending");
    onLineStart?.(el);
    const result = scrambleReveal(el, text, { maxDuration: lineDuration, ...scrambleOptions });
    result.promise.then(() => onLineSettle?.(el));
    return result;
  };

  let cancelled = false;
  const activeCancels = [];

  if (sequential) {
    (async () => {
      for (const { el, text } of leaves) {
        if (cancelled) return;
        const { cancel, promise } = startLine(el, text);
        activeCancels.push(cancel);
        await promise;
        if (cancelled) return;
        await wait(linePause);
      }
    })();
  } else {
    leaves.forEach(({ el, text }, index) => {
      const timeoutId = setTimeout(() => {
        if (cancelled) return;
        const { cancel } = startLine(el, text);
        activeCancels.push(cancel);
      }, index * lineStagger);
      activeCancels.push(() => clearTimeout(timeoutId));
    });
  }

  return () => {
    cancelled = true;
    activeCancels.forEach((c) => c());
  };
}
