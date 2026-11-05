// The commands the prompt understands besides a bare section name. Each one:
//   usage  how `help` shows it (omitted for hidden easter eggs)
//   desc   its one-line description in `help`
//   args   () => the words its argument completes to (optional)
//   run    (arg, ctx, rawArg) => output lines (an array of strings) or nothing
// `arg` is everything typed after the command, trimmed and normalized
// (lowercase, no accents); `rawArg` is the same as typed. `ctx` is the
// prompt's side of things: { go, clear, history, powerOff }.

import { content } from "../data/content.js";
import { ROUTES, getCurrentRoute } from "../router.js";
import { THEME_NAMES, getTheme, resolveThemeName, setTheme } from "./theme.js";

const { user, host, since } = content.shell;

function goTo(arg, ctx, command) {
  if (!arg || arg === "~") {
    ctx.go(ROUTES[0]);
    return undefined;
  }
  if (arg === ".." || arg === "/") return [`${command} : déjà à la racine`];
  const name = arg.replace(/\/$/, "");
  const route = /^[1-9]$/.test(name) ? ROUTES[Number(name) - 1] : ROUTES.find((r) => r.startsWith(name));
  if (!route) return [`${command} : ${arg} : section introuvable — essayez ls`];
  ctx.go(route);
  return undefined;
}

export const COMMANDS = {
  help: {
    usage: "help",
    desc: "cette aide",
    run: () => helpLines(),
  },
  ls: {
    usage: "ls",
    desc: "lister les sections",
    run: () => [ROUTES.map((route, index) => `[${index + 1}] ${route}/`).join("   ")],
  },
  cd: {
    usage: "cd <section>",
    desc: "aller à une section (le nom seul suffit aussi)",
    args: () => ROUTES,
    run: (arg, ctx) => goTo(arg, ctx, "cd"),
  },
  theme: {
    usage: "theme <nom>",
    desc: `changer la couleur du phosphore (${THEME_NAMES.join(", ")})`,
    args: () => THEME_NAMES,
    run: (arg) => {
      if (!arg) return [`phosphore actuel : ${getTheme()} — disponibles : ${THEME_NAMES.join(", ")}`];
      const name = resolveThemeName(arg) ?? THEME_NAMES.find((theme) => theme.startsWith(arg));
      if (!name) return [`theme : ${arg} : phosphore inconnu — disponibles : ${THEME_NAMES.join(", ")}`];
      setTheme(name);
      return [`phosphore ${name} activé`];
    },
  },
  whoami: {
    usage: "whoami",
    desc: "qui est derrière ce terminal",
    run: () => [`${user} — ${content.hero.name}, ${content.hero.title.toLowerCase()} · ${content.hero.location}`],
  },
  neofetch: {
    usage: "neofetch",
    desc: "infos système",
    run: () => {
      const title = `${user}@${host}`;
      return [
        title,
        "-".repeat(title.length),
        `nom      ${content.hero.name}`,
        `métier   ${content.hero.title}`,
        `lieu     ${content.hero.location}`,
        `uptime   ${uptime()} (depuis ${since})`,
        `stack    ${content.competences.map((group) => group.items[0]).join(", ")}`,
        `thème    phosphore ${getTheme()}`,
      ];
    },
  },
  uptime: {
    usage: "uptime",
    desc: "depuis quand ce développeur est en service",
    run: () => [`en ligne depuis ${since} — ${uptime()}`],
  },
  pwd: {
    usage: "pwd",
    desc: "section courante",
    run: () => [`/home/${user}/${getCurrentRoute()}`],
  },
  date: {
    usage: "date",
    desc: "date et heure",
    run: () => [new Date().toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })],
  },
  echo: {
    usage: "echo <texte>",
    desc: "afficher un texte",
    // the raw text, not the normalized (lowercased, accentless) `arg`
    run: (_, __, rawArg) => [rawArg],
  },
  history: {
    usage: "history",
    desc: "commandes précédentes (aussi avec ↑ sur une ligne vide)",
    run: (_, ctx) =>
      ctx.history.length ? ctx.history.map((line, index) => `${String(index + 1).padStart(3)}  ${line}`) : ["historique vide"],
  },
  clear: {
    usage: "clear",
    desc: "effacer l'écran",
    run: (_, ctx) => {
      ctx.clear();
    },
  },
  exit: {
    usage: "exit",
    desc: "éteindre l'écran",
    run: (_, ctx) => {
      ctx.powerOff();
      return ["extinction… appuyez sur une touche pour rallumer"];
    },
  },

  // hidden: not listed by `help`, nor offered as completions
  cat: {
    args: () => ROUTES,
    run: (arg, ctx) => goTo(arg, ctx, "cat"),
  },
  sudo: {
    run: () => [`${user} n'est pas dans le fichier sudoers. Cet incident sera signalé.`],
  },
  rm: {
    run: () => ["rm : permission refusée — rien ne s'efface ici"],
  },
};

/** Commands offered as completions (the visible ones). */
export const COMMAND_NAMES = Object.keys(COMMANDS).filter((name) => COMMANDS[name].usage);

function uptime() {
  const years = new Date().getFullYear() - since;
  return `${years} ans`;
}

function helpLines() {
  const listed = COMMAND_NAMES.map((name) => COMMANDS[name]);
  const width = Math.max(...listed.map((command) => command.usage.length)) + 3;
  return [
    "commandes disponibles :",
    ...listed.map((command) => `  ${command.usage.padEnd(width)}${command.desc}`),
    `  ${"<section>".padEnd(width)}${ROUTES.join(", ")} — ou 1 à ${ROUTES.length}`,
  ];
}
