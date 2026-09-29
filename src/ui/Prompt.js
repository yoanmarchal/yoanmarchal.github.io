import { ROUTES, ROUTE_LABELS, getCurrentRoute, navigateTo } from "../router.js";

const CURSOR_BLINK_MS = 530;
const MESSAGE_MS = 2500;
const PLACEHOLDER = "tapez une section · tab pour compléter";

// accent- and case-insensitive, so "compé" matches "competences"; NFD keeps
// one base letter per accented one, so lengths line up with the route ids
function normalize(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// "projets", "cd projets" and "4" all resolve to the projets route
function parseQuery(value) {
  return normalize(value.trimStart()).replace(/^cd\s+/, "");
}

function findMatches(query) {
  if (/^[1-9]$/.test(query)) {
    const route = ROUTES[Number(query) - 1];
    return route ? [route] : [];
  }
  return ROUTES.filter((route) => route.startsWith(query.trim()));
}

function span(className) {
  const el = document.createElement("span");
  el.className = className;
  return el;
}

/**
 * The terminal prompt shown under each section: a real <input> (focusable,
 * labelled, opens the mobile keyboard) made invisible, with its value,
 * block cursor and inline completion re-drawn as plain spans next to it -
 * TextWarpLayer only mirrors element text, never an input's value.
 *
 * Typing filters the section names shown below the line; Tab / → accepts
 * the inline completion, ↑/↓ cycle through the matches, Enter goes to the
 * highlighted one, Escape clears. Typing a letter anywhere on the page
 * focuses it.
 *
 * Returns { element, show, hide }. It starts hidden; main.js shows it once
 * a section has finished revealing, so it reads as the terminal waiting for
 * input after printing.
 */
export function createPrompt() {
  const element = document.createElement("div");
  element.className = "prompt";
  element.hidden = true;

  const line = document.createElement("p");
  line.className = "prompt-line";

  const caret = span("prompt-caret");
  caret.textContent = ">";
  caret.setAttribute("aria-hidden", "true");

  const field = span("prompt-field");
  const before = span("prompt-typed");
  // a block cursor sitting ON the next character, like a real terminal:
  // the block and the character under it are two separate leaves, so
  // TextWarpLayer paints the block first and the (inverted) glyph over it
  const cursor = span("cursor");
  const cursorBlock = span("cursor-block");
  cursorBlock.textContent = "█";
  const cursorChar = span("cursor-char");
  cursor.append(cursorBlock, cursorChar);
  const after = span("prompt-typed");
  const ghost = span("prompt-ghost");
  const mirror = [before, cursor, after, ghost];
  mirror.forEach((el) => el.setAttribute("aria-hidden", "true"));

  const input = document.createElement("input");
  input.type = "text";
  input.className = "prompt-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("enterkeyhint", "go");
  input.setAttribute("aria-label", "Aller à une section");
  input.setAttribute("aria-describedby", "prompt-help");

  field.append(before, cursor, after, ghost, input);
  line.append(caret, field);

  const help = document.createElement("p");
  help.id = "prompt-help";
  help.className = "sr-only";
  help.textContent = `Tapez le nom d'une section (${ROUTES.join(", ")}), Tab pour compléter, Entrée pour y aller.`;

  // mirrors the completion list for the eye; the buttons are also a
  // touch-friendly way to pick a section
  const suggestions = document.createElement("ul");
  suggestions.className = "prompt-suggestions";
  suggestions.hidden = true;
  // keep focus in the input when a suggestion is pressed, otherwise the
  // blur would hide the list before the click lands
  suggestions.addEventListener("pointerdown", (event) => event.preventDefault());

  const message = document.createElement("p");
  message.className = "prompt-message";
  message.setAttribute("role", "status");

  element.append(line, suggestions, message, help);

  let matches = [...ROUTES];
  let activeIndex = 0;
  let messageTimer;
  let focusOnShow = false;

  function showMessage(text) {
    message.textContent = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message.textContent = "";
    }, MESSAGE_MS);
  }

  function go(route) {
    input.value = "";
    if (route === getCurrentRoute()) {
      update();
      return;
    }
    // the new panel re-creates the prompt's position; bring focus back to
    // it once it reappears so the user can keep typing
    focusOnShow = true;
    showMessage("");
    navigateTo(route);
  }

  function renderSuggestions(focused) {
    suggestions.hidden = !focused || matches.length === 0;
    suggestions.replaceChildren(
      ...matches.map((route, index) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.textContent = route;
        button.classList.toggle("is-active", index === activeIndex);
        button.setAttribute("aria-label", ROUTE_LABELS[route]);
        button.addEventListener("click", () => go(route));
        item.append(button);
        return item;
      })
    );
  }

  function update() {
    const value = input.value;
    const focused = document.activeElement === input;
    const caretAt = input.selectionEnd ?? value.length;

    const query = parseQuery(value);
    matches = findMatches(query);
    activeIndex = Math.min(activeIndex, Math.max(matches.length - 1, 0));

    let afterText = value.slice(caretAt);
    let ghostText = "";

    // inline completion only while typing at the end of a prefix match
    const active = matches[activeIndex];
    const typedWord = query.trim();
    if (!value) {
      ghostText = focused ? "" : PLACEHOLDER;
    } else if (active && caretAt === value.length && typedWord && active.startsWith(typedWord)) {
      ghostText = active.slice(typedWord.length);
    }

    // the character under the cursor is taken out of the text after it
    // (typed text first, else the completion), so nothing shifts sideways
    let underCursor = "";
    let underIsGhost = false;
    if (afterText) {
      underCursor = afterText[0];
      afterText = afterText.slice(1);
    } else if (value && ghostText) {
      underCursor = ghostText[0];
      ghostText = ghostText.slice(1);
      underIsGhost = true;
    }

    before.textContent = value.slice(0, caretAt);
    cursorChar.textContent = underCursor;
    cursor.classList.toggle("is-ghost", underIsGhost);
    after.textContent = afterText;
    ghost.textContent = ghostText;
    ghost.classList.toggle("is-placeholder", !value);

    element.classList.toggle("is-focused", focused);
    renderSuggestions(focused);
  }

  function complete() {
    const active = matches[activeIndex];
    if (!active || !input.value.trim()) return false;
    const prefix = input.value.match(/^\s*(cd\s+)?/i)[0];
    if (input.value === prefix + active) return false;
    input.value = prefix + active;
    input.setSelectionRange(input.value.length, input.value.length);
    update();
    return true;
  }

  input.addEventListener("input", () => {
    activeIndex = 0;
    message.textContent = "";
    cursor.classList.remove("is-off");
    update();
  });

  input.addEventListener("keydown", (event) => {
    if ((event.key === "Tab" && !event.shiftKey) || event.key === "ArrowRight") {
      // only swallow Tab when it actually completed something, so it still
      // moves focus on an empty/complete line
      if (input.selectionEnd === input.value.length && complete()) event.preventDefault();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      activeIndex = (activeIndex + step + matches.length) % matches.length;
      update();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!input.value.trim()) return;
      const route = matches[activeIndex];
      if (route) go(route);
      else showMessage(`section introuvable : ${input.value.trim()} — essayez ${ROUTES.join(", ")}`);
    } else if (event.key === "Escape") {
      input.value = "";
      update();
      input.blur();
    }
  });

  // caret moves (clicks, Home/End, ←) don't fire `input`
  input.addEventListener("keyup", update);
  input.addEventListener("click", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", update);

  // typing a letter anywhere on the page starts a command, like a terminal
  // that's always listening - focusing during keydown lets the character
  // land in the input
  window.addEventListener("keydown", (event) => {
    if (element.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.length !== 1 || !/\p{L}/u.test(event.key)) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    input.focus();
  });

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setInterval(() => {
      // steady while typing, blinking while idle
      if (!element.hidden) cursor.classList.toggle("is-off");
    }, CURSOR_BLINK_MS);
  }

  update();

  return {
    element,
    show() {
      element.hidden = false;
      if (focusOnShow) {
        focusOnShow = false;
        input.focus();
      }
      update();
    },
    hide() {
      element.hidden = true;
      suggestions.hidden = true;
    },
  };
}
