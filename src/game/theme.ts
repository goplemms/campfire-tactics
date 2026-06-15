/**
 * The game's visual atomics — the single ladder every scene tunes from.
 *
 * Phaser renders each `Text` to a canvas texture, baking `fontSize`/`fontFamily`
 * into a CSS font string, and draws fills/strokes from numeric `0xRRGGBB`
 * colours. Rather than scatter those literals across a few thousand lines of
 * scene and component code, we name them once here: {@link FONT} + {@link WEIGHT}
 * for type, {@link COLOR} for graphics fills/strokes, {@link INK} for text
 * colours, and {@link ROLE} for the per-unit identity palette.
 *
 * Reference these instead of raw literals so the whole look retunes from one
 * place — restyle every nameplate, button and tile by editing a constant.
 */

/**
 * Standard font sizes, as Phaser-ready px strings.
 *
 * These are plain `px` — the only unit that interacts sanely with the Scale
 * Manager (`em`/`rem` resolve against the DOM/root, not the scene, and confuse
 * Phaser's own text metrics).
 */
export const FONT = {
  /** Token initials and tiny in-world glyphs. */
  micro: "9px",
  /** Unit nameplates, HP readouts, status glyphs. */
  nameplate: "10px",
  /** Dense list rows (turn order) and compact labels. */
  caption: "11px",
  /** Secondary labels and sub-headers. */
  label: "12px",
  /** Default body text — the common case. */
  body: "13px",
  /** Emphasized map markers / minor headings. */
  heading: "16px",
  /** Per-scene titles. */
  title: "18px",
  /** Overlay and end-screen titles. */
  display: "22px",
  /**
   * The UI typeface — the *one* knob that retunes the whole game's type: swap
   * this value and every nameplate, button and title follows.
   *
   * "Courier Prime" is a warm, well-drawn typewriter monospace (bundled in
   * `fonts.css`, awaited in main.ts before boot) — a "field journal by
   * firelight" feel that keeps the column alignment the turn rail and HP
   * readouts rely on. The fallback chain degrades to the system Courier (the
   * old default) if the web font is blocked.
   */
  family: '"Courier Prime", "Courier New", Courier, monospace',
} as const;

/** Font weights, as Phaser `fontStyle` strings. */
export const WEIGHT = {
  regular: "normal",
  bold: "bold",
} as const;

/**
 * Board/UI fill & stroke colours as Phaser numeric literals (`0xRRGGBB`), for
 * `Graphics`, `Rectangle`s and token bodies. Text colours live in {@link INK};
 * per-unit identity colours in {@link ROLE}.
 *
 * Consolidated from the hand-tuned literals the scenes grew: the ~half-dozen
 * near-identical dark panels collapse to a four-step surface ladder, and the
 * scattered reds/greens/golds each resolve to one canonical hue per intent.
 */
export const COLOR = {
  /** Base primitives — impact flashes, hairline borders. */
  white: 0xffffff,
  black: 0x000000,

  // Surfaces — canvas up through raised, interactive panels. Warm charcoal: the
  // game is named for a campfire, so the dark steps carry an ember undertone
  // rather than the old blue-black, reading as firelit dusk instead of cold steel.
  /** Canvas background and modal backings. */
  bg: 0x16110d,
  /** Panel backings, hint-card body, the turn-order rail. */
  surface: 0x1d1711,
  /** Unselected rows, inputs and disabled fills. */
  surfaceRaised: 0x271e16,
  /** Selected / hovered rows, hint-card header. */
  surfaceAlt: 0x3a2a1c,

  // Structure — warm ember-brown strokes (was cold slate-blue).
  /** Default panel, grid and dim-control stroke. */
  border: 0x5a4630,
  /** Lighter divider, hint-card edge, enabled-control stroke. */
  borderSoft: 0x76583a,

  // Board tiles — warm stone/earth lit by firelight, with a wide light/dark split
  // so the grid reads at a glance without turning into a loud chessboard.
  tileDark: 0x241c15,
  tileLight: 0x382a1d,
  /** Impassable terrain. */
  tileBlocked: 0x4a2c2c,

  // Factions — token body fill / edge ring.
  ally: 0xffcf6b,
  allyEdge: 0x6b4a1c,
  foe: 0xe06b6b,
  foeEdge: 0x6b1c1c,
  /** A captured (turned) unit. */
  captive: 0x9a6bd0,
  captiveEdge: 0x4a2c6b,

  // Status & interaction.
  /** Health, confirm, ally control. */
  success: 0x57b07a,
  /** Sage button fill, safe zone, selected row. */
  successDeep: 0x2f6b46,
  /** Reachable / hover / live-path highlight — bright firelight (was mint green). */
  accent: 0xf2b65a,
  /** Failure, enemy-controlled fill, critical HP. */
  danger: 0xb05757,
  /** Enemy attack-range outline. */
  threat: 0xe07b7b,
  /** Economy, caution HP, intel markers. */
  gold: 0xd8b24a,
  /** Movement-range tile wash — warm ember glow (was cold steel-blue). */
  reach: 0xc87a32,
  /** Intel panels, recruiter / merchant / pinned accents — warm tan (was blue). */
  info: 0xc09a5a,
  /** Capture-net cage FX. */
  net: 0xe6d8b0,

  // Buttons — warm leather (was cold slate).
  btnFill: 0x3d3325,
  btnStroke: 0x97774a,
} as const;

/**
 * Text colours as CSS strings for Phaser `Text`. Fills and strokes live in
 * {@link COLOR}; these stay strings because that's what `TextStyle.color` wants.
 */
export const INK = {
  /** Titles and key headings — warm parchment white (was blue-white). */
  primary: "#f4ede0",
  /** Body copy — the common case. */
  secondary: "#ddd3c2",
  /** Hints and secondary captions. */
  muted: "#b2a48b",
  /** Greyed / unavailable. */
  disabled: "#80766a",
  /** Enabled list labels. */
  bright: "#ece3d2",
  /** Text on a light token / map-node glyph. */
  onLight: "#1a1410",
  /** Positive numbers and messages. */
  success: "#9ff0bf",
  /** Labels on green buttons. */
  onSuccess: "#eafff0",
  /** Economy, intel and board headers. */
  gold: "#d6c98a",
  /** Warm urgency — timers, deploy markers. */
  ember: "#f0b06a",
  /** Failure text and damage numbers. */
  danger: "#f0a0a0",
  /** Cleanse / status-clear. */
  cyan: "#9fe0e0",
} as const;

/**
 * Per-unit identity colours for token rings — a deliberate palette so the knight,
 * scout and medic read apart at a glance (see {@link "./roles"}). Kept distinct
 * from {@link COLOR}: these are *identifiers*, not states, so they're not folded
 * into the semantic set. Foes reuse the matching job hue (a bowman is a hunter).
 */
export const ROLE = {
  soldier: 0x6f9bd6, //     steel  — frontline / tank
  hunter: 0xe0b24a, //      amber  — ranged (also foe bowman/archer)
  scout: 0x6fd69b, //       green  — mobility / recon
  medic: 0x8fe0d0, //       cyan   — sustain
  chef: 0xe0903a, //        orange — support
  merchant: 0xd6c24a, //    gold   — economy
  survivalist: 0x9bd66f, // leaf   — traps
  trapper: 0x4fb0a0, //     teal   — debuffer (job + foe)
  captain: 0xf0c060, //     bright — the leader
  skirmisher: 0xc07fd0, //  violet — thief / assassin
  sapper: 0xe0843a, //      orange — objective threat
} as const;
