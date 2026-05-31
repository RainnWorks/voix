/**
 * Design tokens for the desktop / web UI.
 *
 * Per voix-desktop-guide.html the desktop brand is deliberately sober:
 * system fonts, system chrome colours, HA blue used only for "Voix
 * moments" (the puck, status pills, the VOIX speaker tag, active-mode
 * tags). The marketing brand's Instrument Serif + cream paper lives
 * on the website — NOT in this app.
 *
 * The 12-colour mode palette is a deliberate exception to the
 * marketing brand's "three colours full stop" — but constrained so
 * users can't break the system: six saturated for work modes, six
 * soft for calmer modes, evenly distributed across the hue wheel.
 */

export const colors = {
  // Surfaces — kept neutral / system. NOT the cream paper.
  bg: "#fafafa",
  bgElevated: "#ffffff",
  bgSubtle: "rgba(0,0,0,0.025)",
  bgHover: "rgba(0,0,0,0.04)",

  // Ink (text + puck body). Never pure black.
  ink: "#18181b",
  inkSoft: "#2a2a2e",
  textBody: "#3f3f46",
  textMuted: "#8b8b90",
  textQuiet: "#a1a1a8",

  // Rules + borders — 0.5px is the brand norm; CSS rounds it to 1px
  // on standard DPI but it reads correctly on Retina.
  rule: "rgba(0,0,0,0.08)",
  ruleSoft: "rgba(0,0,0,0.06)",

  // Inactive page-dot tint (light mode). A visible neutral so the
  // 3-of-N onboarding indicator reads as three markers, not one.
  // The dark-mode counterpart is a light-on-dark neutral resolved in
  // the onboarding palette (theme.ts is light-only). Tokenised here so
  // the magic `rgba(0,0,0,0.2)` literal no longer lives inline (Marina
  // v4 — page-dot colour-discipline).
  pageDotInactive: "rgba(0,0,0,0.2)",

  // System accent. On macOS this should track the user's accent;
  // we hard-code Apple's default blue here as a sensible fallback.
  // Used for selection highlights, focus rings, links, dropdowns,
  // form button defaults — anything CHROME-shaped.
  sysAccent: "#007AFF",
  sysAccentDark: "#0A84FF",
  // Tinted accent fill for chrome buttons / selected chips — the system
  // accent at low alpha. The HA-blue-tinted `haBlueBg` used to stand in
  // here, which spent the reserved brand blue on plain chrome (Marina
  // v3 #3). Chrome uses THIS; HA blue stays for voix moments.
  sysAccentBg: "rgba(0,122,255,0.10)",

  // HA blue. THE brand colour. Used for: puck centre dot, "● LIVE"
  // status, VOIX speaker prefix, active-mode pill on the modes list,
  // pulsing rings emanating from the puck during a session. Never
  // chrome. Treat this as a **fill / accent** token, not a text
  // foreground — at 11pt italic on bgSubtle it lands at 2.49:1 and
  // fails WCAG AA. For text foreground use `haBlueText` below.
  haBlue: "#03A9F4",
  haBlueBg: "rgba(3,169,244,0.08)",
  // HA-blue darkened to clear WCAG AA contrast as TEXT FOREGROUND.
  // Material blue 800 — 4.86:1 against bgSubtle's effective #f9f9f9
  // surface, 5.0:1 against bgElevated #ffffff. Use this anywhere
  // haBlue used to land as a `color:` on a Text node (tone snippets,
  // status labels, link-style buttons). Keeps haBlue for fills,
  // borders, glyphs (where contrast math doesn't apply).
  haBlueText: "#0277BD",

  // Semantic danger surface for error toasts + invalid form rows.
  // Hand-rolled hex previously lived inline in VoiceEditor — tokenised
  // in M04 after Marina (audit agent) flagged the duplication.
  danger: "#a02d20",
  dangerBg: "#fff3f0",
  dangerBorder: "#f5c6c0",
} as const;

/**
 * Twelve mode colours. Six saturated for primary work modes, six
 * soft for calmer modes. The puck's INNER circle takes this; the
 * outer body stays ink/dark. Users pick from these twelve — no
 * arbitrary hex input. The discipline is the brand.
 */
export const modePalette = {
  // Saturated row
  haBlue: { name: "HA blue", hex: "#03A9F4", rgb: [3, 169, 244] as const },
  amber: { name: "Amber", hex: "#F59E0B", rgb: [245, 158, 11] as const },
  violet: { name: "Violet", hex: "#8B5CF6", rgb: [139, 92, 246] as const },
  green: { name: "Green", hex: "#10B981", rgb: [16, 185, 129] as const },
  coral: { name: "Coral", hex: "#F97316", rgb: [249, 115, 22] as const },
  magenta: { name: "Magenta", hex: "#EC4899", rgb: [236, 72, 153] as const },
  // Soft row
  sky: { name: "Sky", hex: "#7DD3FC", rgb: [125, 211, 252] as const },
  lemon: { name: "Lemon", hex: "#FDE047", rgb: [253, 224, 71] as const },
  lavender: { name: "Lavender", hex: "#C4B5FD", rgb: [196, 181, 253] as const },
  mint: { name: "Mint", hex: "#6EE7B7", rgb: [110, 231, 183] as const },
  peach: { name: "Peach", hex: "#FDBA74", rgb: [253, 186, 116] as const },
  slate: { name: "Slate", hex: "#94A3B8", rgb: [148, 163, 184] as const },
} as const;

/** Stable order for the swatch picker — saturated first, then soft. */
export const paletteOrder: Array<keyof typeof modePalette> = [
  "haBlue",
  "amber",
  "violet",
  "green",
  "coral",
  "magenta",
  "sky",
  "lemon",
  "lavender",
  "mint",
  "peach",
  "slate",
];

/** Pick the closest palette entry to an arbitrary [r,g,b] so existing
 *  modes (which stored arbitrary RGB pre-palette) render with the
 *  right swatch. Distance = sum of squared channel deltas. */
export function nearestSwatch(rgb: readonly [number, number, number]) {
  let bestKey: keyof typeof modePalette = "haBlue";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const key of paletteOrder) {
    const e = modePalette[key];
    const dr = e.rgb[0] - rgb[0];
    const dg = e.rgb[1] - rgb[1];
    const db = e.rgb[2] - rgb[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = key;
    }
  }
  return { key: bestKey, ...modePalette[bestKey] };
}

/**
 * System font stack — what makes this feel like a native app instead
 * of a webview. On macOS resolves to SF Pro; on Windows to Segoe UI
 * Variable; on Linux to whatever the user's system sans is. NEVER
 * substitute Inter / Geist / Manrope / Söhne / Hanken Grotesk here —
 * those are the marketing brand's typography, not the desktop's.
 */
export const fontFamily = {
  ui:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', " +
    "'Segoe UI', system-ui, sans-serif",
  mono:
    "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 5,
  md: 6,
  lg: 10,
  xl: 14,
} as const;
