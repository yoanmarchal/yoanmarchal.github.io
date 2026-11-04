import { ROUTES, ROUTE_LABELS, getCurrentRoute, navigateTo } from "../router.js";
import { COMMANDS, COMMAND_NAMES } from "./shell.js";

const CURSOR_BLINK_MS = 530;
const PLACEHOLDER = "tapez help ou une section · tab pour compléter";
// scrollback kept above the prompt line - older lines scroll off the top
const MAX_OUTPUT_LINES = 60;
const MAX_HISTORY = 50;
// offered on an empty line, next to the sections
const EMPTY_LINE_COMMANDS = ["help"];

// accent- and case-insensitive, so "compé" matches "competences"; NFD keeps
// one base letter per accented one, so lengths line up with the raw value
// and positions found in the normalized text can slice the raw one
function normalize(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function findRoutes(query) {
  if (/^[1-9]$/.test(query)) {
    const route = ROUTES[Number(query) - 1];
    return route ? [route] : [];
  }
  return ROUTES.filter((route) => route.startsWith(query));
}

// Two kinds of line:
// - "word": a single word being typed - a section ("projets", "4") or a
//   command name; `matches` are both
// - "arg": a command followed by a space ("theme am", "cd pro"); `matches`
//   are that command's argument completions
// `typed` is the (normalized) word being completed, `prefix` the raw text
// before it, `rawArg` the argument as typed (for `echo`).
function parseLine(value) {
  const lead = value.length - value.trimStart().length;
  const query = normalize(value.slice(lead));

  const command = query.match(/^(\S+)\s+/);
  if (command) {
    const name = command[1];
    const typed = query.slice(command[0].length).trim();
    const candidates = COMMANDS[name]?.args?.() ?? [];
    return {
      kind: "arg",
      command: name,
      typed,
      prefix: value.slice(0, lead + command[0].length),
      rawArg: value.slice(lead + command[0].length).trim(),
      matches: /\s/.test(typed) ? [] : candidates.filter((candidate) => candidate.startsWith(typed)),
    };
  }

  const typed = query.trim();
  let matches;
  if (!typed) matches = [...ROUTES, ...EMPTY_LINE_COMMANDS];
  else if (/^[1-9]$/.test(typed)) matches = findRoutes(typed);
  else matches = [...findRoutes(typed), ...COMMAND_NAMES.filter((name) => name.startsWith(typed))];
  return { kind: "word", typed, prefix: value.slice(0, lead), matches };
}

function suggestionLabel(line, item) {
  if (line.kind === "word") {
    return ROUTES.includes(item) ? ROUTE_LABELS[item] : `Commande ${item} : ${COMMANDS[item].desc}`;
  }
  if (ROUTES.includes(item)) return ROUTE_LABELS[item];
  return `${line.command} ${item}`;
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
 * It's a small shell: a section name navigates, and the commands in
 * shell.js (help, ls, cd, theme, whoami, exit…) print their output above
 * the line, terminal-style, until the next section change or `clear`.
 * Tab / → accepts the inline completion, ↑/↓ cycle through the matches -
 * or through the command history, from an empty line - Enter runs, Escape
 * clears. Typing a letter anywhere on the page focuses it.
 *
 * `powerOff` is called by `exit`.
 *
 * Returns { element, show, hide }. It starts hidden; main.js shows it once
 * a section has finished revealing, so it reads as the terminal waiting for
 * input after printing.
 */
export function createPrompt({ powerOff = () => {} } = {}) {
  const element = document.createElement("div");
  element.className = "prompt";
  element.hidden = true;

  // the scrollback: each run command's echo + its output. A log region, so
  // the output is announced; the echo is aria-hidden (the user just typed it)
  const output = document.createElement("div");
  output.className = "prompt-output";
  output.setAttribute("role", "log");

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
  input.setAttribute("aria-label", "Ligne de commande");
  input.setAttribute("aria-describedby", "prompt-help");

  field.append(before, cursor, after, ghost, input);
  line.append(caret, field);

  const help = document.createElement("p");
  help.id = "prompt-help";
  help.className = "sr-only";
  help.textContent = `Tapez le nom d'une section (${ROUTES.join(", ")}) ou une commande, help pour la liste. Tab pour compléter, Entrée pour exécuter, flèche haut sur une ligne vide pour l'historique.`;

  // mirrors the completion list for the eye; the buttons are also a
  // touch-friendly way to pick a section
  const suggestions = document.createElement("ul");
  suggestions.className = "prompt-suggestions";
  suggestions.hidden = true;
  // keep focus in the input when a suggestion is pressed, otherwise the
  // blur would hide the list before the click lands
  suggestions.addEventListener("pointerdown", (event) => event.preventDefault());

  element.append(output, line, suggestions, help);

  let parsed = parseLine("");
  let matches = parsed.matches;
  let activeIndex = 0;
  // ↑/↓ picked a suggestion since the last keystroke - Enter then uses it
  // even where the typed text alone would mean something else
  let navigated = false;
  let focusOnShow = false;

  const history = [];
  // == history.length while not browsing it
  let historyIndex = 0;

  function print(lines, className = "prompt-out") {
    for (const text of lines) {
      const p = document.createElement("p");
      p.className = className;
      p.textContent = text;
      if (className === "prompt-echo") p.setAttribute("aria-hidden", "true");
      output.append(p);
    }
    while (output.childElementCount > MAX_OUTPUT_LINES) output.firstElementChild.remove();
    keepInView();
  }

  // Scrolls .screen-inner just enough for the prompt line - and the
  // suggestions under it, when shown - to sit above its bottom padding: the
  // band where the glass curves away and the vignette darkens. Done by hand
  // rather than with scrollIntoView, which would also scroll the
  // overflow:hidden tube around it.
  function keepInView() {
    const scroller = element.closest(".screen-inner");
    if (!scroller || element.hidden) return;
    const target = suggestions.hidden ? line : suggestions;
    const margin = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
    const overflow = target.getBoundingClientRect().bottom - (scroller.getBoundingClientRect().bottom - margin);
    if (overflow > 0) scroller.scrollTop += Math.ceil(overflow);
  }

  // focus without the browser's own scroll-into-view (see keepInView)
  function focusInput() {
    input.focus({ preventScroll: true });
    keepInView();
  }

  function clearOutput() {
    output.replaceChildren();
  }

  function go(route) {
    if (route === getCurrentRoute()) return;
    // the new panel re-creates the prompt's position; bring focus back to
    // it once it reappears so the user can keep typing
    focusOnShow = true;
    navigateTo(route);
  }

  const ctx = { go, clear: clearOutput, history, powerOff };

  // a new line: the completion state starts over with it
  function setValue(value) {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    activeIndex = 0;
    navigated = false;
    update();
  }

  function remember(command) {
    if (history[history.length - 1] !== command) history.push(command);
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length;
  }

  function run(name, arg, rawArg, echo) {
    print([`> ${echo}`], "prompt-echo");
    const lines = COMMANDS[name].run(arg, ctx, rawArg);
    if (lines) print(lines);
  }

  // a suggestion button: a section navigates, a command taking an argument
  // is filled in for it, anything else runs
  function pick(item) {
    if (parsed.kind === "arg") {
      run(parsed.command, item, item, `${parsed.command} ${item}`);
      remember(`${parsed.command} ${item}`);
      setValue("");
    } else if (ROUTES.includes(item)) {
      setValue("");
      go(item);
    } else if (COMMANDS[item].args) {
      setValue(`${item} `);
      focusInput();
    } else {
      run(item, "", "", item);
      remember(item);
      setValue("");
    }
  }

  function submit() {
    const raw = input.value.trim();
    if (!raw) {
      // an empty line can still have a suggestion picked with ↑/↓
      const picked = matches[activeIndex];
      if (navigated && picked) pick(picked);
      return;
    }
    const current = parseLine(input.value);
    // read before the line is cleared, which resets the completion state
    const active = current.matches[activeIndex];
    const usedArrows = navigated;
    // what actually ran: "theme" + ↓ to "ambre" is remembered as "theme ambre"
    const ran = current.kind === "arg" && usedArrows && active ? `${current.prefix.trim()} ${active}` : raw;
    remember(ran);
    setValue("");

    if (current.kind === "arg") {
      if (!COMMANDS[current.command]) {
        print([`> ${raw}`], "prompt-echo");
        print([`${current.command} : commande introuvable — tapez help`]);
        return;
      }
      const arg = usedArrows && active ? active : current.typed;
      run(current.command, arg, current.rawArg, ran);
      return;
    }

    // an exact command name wins (including the hidden ones), then a
    // section, then whatever the completion is pointing at
    const target = COMMANDS[current.typed] ? current.typed : active;
    if (!target) {
      print([`> ${raw}`], "prompt-echo");
      print([`${current.typed} : commande introuvable — tapez help`]);
    } else if (ROUTES.includes(target) && !COMMANDS[current.typed]) {
      go(target);
    } else {
      run(target, "", "", raw);
    }
  }

  function renderSuggestions(focused) {
    suggestions.hidden = !focused || matches.length === 0;
    suggestions.replaceChildren(
      ...matches.map((match, index) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.textContent = match;
        button.classList.toggle("is-active", index === activeIndex);
        button.setAttribute("aria-label", suggestionLabel(parsed, match));
        button.addEventListener("click", () => pick(match));
        item.append(button);
        return item;
      })
    );
  }

  function update() {
    const value = input.value;
    const focused = document.activeElement === input;
    const caretAt = input.selectionEnd ?? value.length;

    parsed = parseLine(value);
    matches = parsed.matches;
    activeIndex = Math.min(activeIndex, Math.max(matches.length - 1, 0));

    let afterText = value.slice(caretAt);
    let ghostText = "";

    // inline completion only while typing at the end of a prefix match
    const active = matches[activeIndex];
    const typedWord = parsed.typed;
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
    if (focused) keepInView();
  }

  function complete() {
    const active = matches[activeIndex];
    if (!parsed.typed || !active) return false;
    // a command that takes an argument gets its trailing space, ready for it
    const space = parsed.kind === "word" && COMMANDS[active]?.args ? " " : "";
    const completed = parsed.prefix + active + space;
    if (input.value === completed) return false;
    setValue(completed);
    return true;
  }

  function browseHistory(step) {
    historyIndex = Math.min(Math.max(historyIndex + step, 0), history.length);
    setValue(history[historyIndex] ?? "");
  }

  input.addEventListener("input", () => {
    activeIndex = 0;
    navigated = false;
    historyIndex = history.length;
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
      const step = event.key === "ArrowDown" ? 1 : -1;
      // history from an empty line, and for as long as it's being browsed
      // (not once ↑/↓ has started picking among the suggestions)
      const browsing = historyIndex < history.length;
      if (history.length && !navigated && (browsing || (!input.value && step < 0))) {
        browseHistory(step);
        return;
      }
      if (matches.length === 0) return;
      navigated = true;
      activeIndex = (activeIndex + step + matches.length) % matches.length;
      update();
    } else if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      historyIndex = history.length;
      setValue("");
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
    focusInput();
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
        focusInput();
      }
      update();
    },
    // a new section is a fresh screen: the scrollback goes with the old one
    hide() {
      element.hidden = true;
      suggestions.hidden = true;
      clearOutput();
    },
  };
}
