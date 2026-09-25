// Deterministic SVG composition and PNG export for the README artwork.
// See README.md in this folder for how to rebuild.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const fontkit = require('fontkit');

const root = __dirname;
const out = path.resolve(root, '..');

// voix brand: ink, Home Assistant blue, warm paper (voix-brand-guide.html).
const C = {
  bg: '#18181B', card: '#232327', puck: '#2A2A2E', rule: '#3A3A40',
  paper: '#FAF8F3', dim: '#A1A1AA', faint: '#71717A', blue: '#03A9F4',
};
// Built-in voice colours, from voix-backend/src/voices/builtins.ts.
const VOICES = [
  ['Realtime', '#FF33CC'], ['Dictation', '#FFB200'], ['Message', '#4CAF50'],
  ['Email', '#2196F3'], ['Note', '#9C27B0'], ['Code', '#00BCD4'],
];

const font = (file, axes) => {
  const f = fontkit.openSync(path.join(root, 'fonts', file));
  return axes ? f.getVariation(axes) : f;
};
const FONTS = {
  serif: [font('InstrumentSerif-Regular.ttf'), 'Instrument Serif'],
  sans: [font('HankenGrotesk.ttf', { wght: 400 }), 'Hanken Grotesk'],
  medium: [font('HankenGrotesk.ttf', { wght: 500 }), 'Hanken Grotesk Medium'],
  mono: [font('JetBrainsMono.ttf', { wght: 400 }), 'JetBrains Mono'],
};
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

// Text is set as glyph paths so the render does not depend on installed fonts.
// The original string stays on each group as aria-label.
function measure(s, size, face = 'sans', tracking = 0) {
  const [f] = FONTS[face];
  const run = f.layout(s);
  return run.positions.reduce((n, p) => n + p.xAdvance, 0) * (size / f.unitsPerEm) + tracking * (s.length - 1);
}
function text(s, x, y, { size = 40, face = 'sans', fill = C.paper, align = 'left', tracking = 0 } = {}) {
  const [f, name] = FONTS[face];
  const run = f.layout(s);
  const scale = size / f.unitsPerEm;
  const width = measure(s, size, face, tracking);
  if (align === 'center') x -= width / 2;
  if (align === 'right') x -= width;
  let cursor = 0;
  const glyphs = run.glyphs.map((g, i) => {
    const p = run.positions[i];
    const d = `<path transform="translate(${cursor + p.xOffset} ${p.yOffset})" d="${g.path.toSVG()}"/>`;
    cursor += p.xAdvance + tracking / scale;
    return d;
  }).join('');
  return `<g aria-label="${esc(s)}" data-font="${name}" fill="${fill}" transform="translate(${x} ${y}) scale(${scale} ${-scale})">${glyphs}</g>`;
}
const rect = (x, y, w, h, r, fill, stroke = 'none', sw = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const circle = (cx, cy, r, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const line = (d, color = C.blue, sw = 5, extra = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const head = (x, y, dir, color = C.blue, s = 13) => {
  const [dx, dy] = { r: [-1, 0], l: [1, 0] }[dir];
  return line(`M${x + dx * s - dy * s} ${y + dy * s - s} L${x} ${y} L${x + dx * s} ${y + s}`, color, 5);
};
function svg(w, h, label, body, bg = C.bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${bg ? rect(0, 0, w, h, 0, bg) : ''}${body}</svg>\n`;
}

// The voix mark (voix-logo-colour.svg) at 1024: ink tile, blue core.
function icon() {
  return svg(1024, 1024, 'voix: a dark rounded tile with a blue dot',
    rect(0, 0, 1024, 1024, 224, C.bg) + circle(512, 512, 176, C.blue), null);
}

// A Voice PE with its LED ring in the active voice's colour.
function puck(cx, cy, size, ring) {
  let b = rect(cx - size / 2, cy - size / 2, size, size, size * 0.23, C.puck);
  const r = size * 0.34;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b += circle(cx + r * Math.cos(a), cy + r * Math.sin(a), size * 0.028, ring);
  }
  b += circle(cx, cy, r, 'none', `stroke="${ring}" stroke-width="${size * 0.05}" opacity="0.22"`);
  b += circle(cx, cy, size * 0.16, '#33333A');
  return b;
}

function hero() {
  let b = '';
  b += puck(380, 400, 470, VOICES[0][1]);
  b += text('HEY MYCROFT', 380, 740, { size: 30, face: 'mono', fill: C.dim, align: 'center', tracking: 4 });

  const lines = [
    ['YOU', 'Turn off the kitchen lights.'],
    ['VOIX', 'Done.'],
    ['YOU', 'Is the back door locked?'],
    ['VOIX', 'Yes, it’s locked.'],
  ];
  let y = 190;
  for (const [who, said] of lines) {
    const voix = who === 'VOIX';
    b += text(who, 740, y, { size: 26, face: 'mono', fill: voix ? C.blue : C.faint, tracking: 2 });
    b += text(said, 860, y + 4, { size: 54, face: 'serif', fill: C.paper });
    y += voix ? 130 : 96;
  }

  // The button on the puck steps through the voices.
  let x = 740;
  const cy = 740;
  for (const [i, [name, colour]] of VOICES.entries()) {
    const w = measure(name, 24, 'medium') + 66;
    const active = i === 0;
    b += rect(x, cy - 29, w, 58, 29, active ? C.card : 'none', active ? colour : C.rule, active ? 3 : 2);
    b += circle(x + 29, cy, 9, colour);
    b += text(name, x + 48, cy + 9, { size: 24, face: 'medium', fill: active ? C.paper : C.dim });
    x += w + 12;
  }
  return svg(1800, 900,
    'A Voice PE with its ring lit pink for the Realtime voice, next to a spoken exchange and the six built-in voices', b);
}

function box(x, y, w, h, title, sub, { accent = false } = {}) {
  let b = rect(x, y, w, h, 24, C.card, accent ? C.blue : 'none', accent ? 4 : 0);
  let ty = y + h / 2 - (sub.length * 44) / 2 + 14;
  b += text(title, x + w / 2, ty, { size: 54, face: 'serif', align: 'center' });
  ty += 58;
  for (const s of sub) {
    b += text(s, x + w / 2, ty, { size: 30, face: 'sans', fill: C.dim, align: 'center' });
    ty += 42;
  }
  return b;
}

function howItWorks() {
  let b = '';
  const W = 440, H = 270, top = 90, bottom = 440;
  const L = 60, M = 680, R = 1300;
  // Left: where you speak, and hear the answer. Centre: the daemon. Right: what it calls.
  b += box(L, top, W, H, 'Voice PE', ['wake word, mic', 'and speaker']);
  b += box(L, bottom, W, H, 'Mac, iOS, web', ['hold to talk']);
  b += box(M, top, W, bottom + H - top, 'voix daemon', ['Home Assistant add-on', '', 'picks the voice,', 'runs the session,', 'keeps the history'], { accent: true });
  b += box(R, top, W, H, 'OpenAI', ['Realtime, transcription', 'and clean-up']);
  b += box(R, bottom, W, H, 'Home Assistant', ['state and services', 'over MCP']);

  for (const y of [top + H / 2, bottom + H / 2]) {
    b += line(`M${L + W + 26} ${y}H${M - 26}`) + head(M - 26, y, 'r') + head(L + W + 26, y, 'l');
    b += line(`M${M + W + 26} ${y}H${R - 26}`) + head(R - 26, y, 'r') + head(M + W + 26, y, 'l');
  }
  return svg(1800, 800,
    'The Voice PE and the Mac, iOS and web apps stream audio to and from the voix daemon, which talks to OpenAI and to Home Assistant over MCP', b);
}

const outputs = { 'icon-1024': icon(), hero: hero(), 'how-it-works': howItWorks() };
(async () => {
  for (const [name, source] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(root, `${name}.svg`), source);
    await sharp(Buffer.from(source)).png({ compressionLevel: 9 }).toFile(path.join(out, `${name}.png`));
    console.log(`wrote ${name}.svg and ../${name}.png`);
  }
})();
