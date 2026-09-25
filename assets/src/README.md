# Voix README artwork

`build.cjs` is the source for all three images: layout, strings, sizes and colours. It writes the SVG sources here and the PNGs to `../`. No generated raster art is used.

## Rebuild

From the repository root, with Node.js 22 or later:

```sh
npm ci --prefix assets/src --no-audit --no-fund
node assets/src/build.cjs
```

The text is set as glyph outlines from the bundled fonts, so the output does not depend on the fonts installed on the computer. Each text group keeps its original string in `aria-label`. To change a string, edit `build.cjs` and rebuild.

## Outputs

- `../icon-1024.png`: 1024 × 1024, from `icon-1024.svg`. It is the mark from `voix-logo-colour.svg` at the repository root.
- `../hero.png`: 1800 × 900, from `hero.svg`. The voice names and colours are the built-in voices in `voix-backend/src/voices/builtins.ts`.
- `../how-it-works.png`: 1800 × 800, from `how-it-works.svg`.

The colours are voix's own: ink `#18181B`, Home Assistant blue `#03A9F4` and paper `#FAF8F3`, as on the site and in `voix-brand-guide.html`.

## Fonts

Bundled in `fonts/`, each under the SIL Open Font License included beside it:

- Instrument Serif, Regular: https://github.com/google/fonts/tree/main/ofl/instrumentserif
- Hanken Grotesk, variable, set at weights 400 and 500: https://github.com/google/fonts/tree/main/ofl/hankengrotesk
- JetBrains Mono, variable, set at weight 400: https://github.com/google/fonts/tree/main/ofl/jetbrainsmono
