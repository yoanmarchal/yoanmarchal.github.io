const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%&*<>/\\|+-=";

const NBSP = " ";

function randomGlyph() {
  return GLYPHS[(Math.random() * GLYPHS.length) | 0];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reveals `text` inside `el` character by character, each character
 * cycling through random glyphs before locking in - a "Matrix decrypt"
 * terminal effect. The real text stays available to assistive tech via
 * aria-label immediately, independent of the animation.
 *
 * Returns { cancel, promise } - promise resolves once every character
 * has settled, so callers can chain lines sequentially.
 */
export function scrambleReveal(el, text, options = {}) {
  const chars = [...text];
  const charDelay =
    options.charDelay ?? Math.max(4, Math.min(24, 900 / Math.max(chars.length, 1)));
  const scrambleDuration = options.scrambleDuration ?? 200;

  const spans = chars.map((ch) => {
    const span = document.createElement("span");
    // a plain " " inside a lone inline box can get whitespace-collapsed
    // away by the browser - NBSP always keeps its width
    span.textContent = ch === " " ? NBSP : ch;
    span.className = "scramble-char";
    return span;
  });

  const wrapper = document.createElement("span");
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.append(...spans);

  el.setAttribute("aria-label", text);
  el.textContent = "";
  el.appendChild(wrapper);

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

  return { cancel: () => cancelAnimationFrame(rafId), promise };
}

function collectLeafTextElements(root) {
  const result = [];
  (function walk(node) {
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
 * - sequential (default): each line fully settles, waits `linePause` ms,
 *   then the next line starts - reads like a real terminal printing a
 *   boot log, consistent across every section.
 * - cascade (sequential: false): lines start `stagger` ms apart and can
 *   overlap - kept as an option, currently unused.
 *
 * Returns a cancel function.
 */
export function animateReveal(root, options = {}) {
  const {
    stagger = 70,
    sequential = true,
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

  leaves.forEach(({ el, text }) => {
    el.setAttribute("aria-label", text);
    el.textContent = "";
    // stays collapsed (no reserved blank line) until this leaf's own
    // animation starts, so nothing shows up-front on load - lines appear
    // one at a time as a real terminal would print them
    el.classList.add("reveal-pending");
  });

  const startLine = (el, text) => {
    el.classList.remove("reveal-pending");
    onLineStart?.(el);
    const result = scrambleReveal(el, text, scrambleOptions);
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
      }, index * stagger);
      activeCancels.push(() => clearTimeout(timeoutId));
    });
  }

  return () => {
    cancelled = true;
    activeCancels.forEach((c) => c());
  };
}
