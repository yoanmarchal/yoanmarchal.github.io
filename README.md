# yoanmarchal.github.io

Portfolio de Yoan Marchal, développeur web à Limoges — présenté comme un écran de terminal CRT bombé.

**En ligne :** https://yoanmarchal.github.io/

## Stack

- JavaScript vanilla, sans framework UI : le DOM est construit en JS
- WebGL brut + shaders GLSL pour la courbure de l'écran et les transitions
- Vite pour le dev et le build, déployé sur GitHub Pages via GitHub Actions

## Développement

```bash
npm install
npm run dev       # serveur de dev
npm run build     # build de production dans dist/
npm run preview   # sert le build localement
```

Tout le texte affiché vient de [`src/data/content.js`](src/data/content.js).

## Raccourcis

- `1` à `5` : changer de section
- N'importe quelle touche / clic pendant le démarrage : le passer
