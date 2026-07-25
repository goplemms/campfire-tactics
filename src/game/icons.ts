/**
 * The icon registry — the single source of truth for every in-game symbol.
 *
 * Until now glyphs were inline string literals scattered across the scenes, which
 * is how the map legend drifted from the board and how emoji-range glyphs (⚔ ⚖ ⛩
 * …) slipped in and degrade wherever an emoji font is missing. This centralizes
 * them the way {@link "./theme".COLOR} / {@link "./theme".INK} centralize colour:
 * every board marker, legend and tooltip reads one {@link ICON} entry, so they
 * can't disagree.
 *
 * **v1 renders glyphs** — a curated palette **verified to render in Courier Prime**
 * (the bundled UI font), so symbols are identical on web/Steam/mobile (no reliance
 * on a platform emoji font). The registry is the **swap point for a future icon
 * atlas**: give an entry a `frame` and teach {@link placeIcon} to prefer an
 * atlas Image, and call sites that route through it don't change.
 */

import Phaser from "phaser";
import { FONT, INK } from "./theme";

/** One symbol: its v1 glyph, a plain-language name (for legends + tooltips), an optional tint, and a reserved atlas frame. */
export interface IconSpec {
  /** The v1 glyph — verified to render in Courier Prime; also usable inline in composed text. */
  glyph: string;
  /** Plain-language label — the *one* source for both the legend and any tooltip. */
  label: string;
  /** Optional associated text colour (CSS string), for standalone markers / legend. */
  color?: string;
  /** Reserved: an icon-atlas frame key. When set (and an atlas is loaded) {@link placeIcon} prefers it. */
  frame?: string;
}

/**
 * The symbol vocabulary. Glyphs are deliberately monospace-safe (Geometric Shapes,
 * General Punctuation, Latin-1, box-drawing) — confirmed to render in Courier Prime.
 */
export const ICON = {
  // --- Overworld node kinds ---
  combat: { glyph: "‡", label: "fight", color: INK.danger },
  rest: { glyph: "≈", label: "rest", color: INK.success },
  goal: { glyph: "★", label: "goal", color: INK.gold },
  thief: { glyph: "$", label: "thief", color: INK.ember },
  shop: { glyph: "¤", label: "market", color: INK.gold },
  recruiter: { glyph: "✚", label: "recruit", color: INK.cyan },
  story: { glyph: "?", label: "story", color: INK.secondary },
  toll: { glyph: "╫", label: "toll", color: INK.gold },
  patron: { glyph: "♛", label: "patron", color: INK.gold },
  fogged: { glyph: "◌", label: "fogged", color: INK.disabled },
  scouted: { glyph: "◉", label: "scouted", color: INK.gold },

  // --- Combat board + status (registry is complete; combat-view migration is a follow-up) ---
  charging: { glyph: "◷", label: "charging" },
  lethal: { glyph: "†", label: "lethal" },
  flank: { glyph: "‡", label: "flanked" },
  // The spotted enemy trap reads as a threat — foe red (COLOR.foe as a CSS string). The
  // registry color IS what the board renders now (was INK.danger here but overridden at the
  // call site — registry drift, #138).
  trapArmed: { glyph: "▲", label: "trap (armed)", color: "#e06b6b" },
  trapSprung: { glyph: "✕", label: "trap (sprung)", color: INK.disabled },
  trapMine: { glyph: "✸", label: "your trap", color: INK.ember },
  // Deploy influence sources (D63): the party's warm safe core, and the closing net's origin.
  campfire: { glyph: "♨", label: "your camp", color: INK.gold },
  netSource: { glyph: "❖", label: "the net's source", color: INK.danger },
  // A cuffed captive's shackle-lock (D90): only a lockpick (the Thief) frees it — the "Pick the Cell" taste.
  locked: { glyph: "⚿", label: "cuffed — needs a lockpick", color: INK.ember },
  // A locked interactable gate/cell (D103): blocks its tile until picked (a Thief) or its keyholder falls.
  gate: { glyph: "▦", label: "locked gate — pick it or defeat its keyholder", color: INK.ember },
  // A pull-lever (D103): toggles its target gate(s) — the control-room seal.
  lever: { glyph: "⎇", label: "lever — pull to seal/open its gate", color: INK.cyan },
  // A smashed door (D106): a destructible gate battered to 0 — a passable remnant, permanent (no reseal).
  gateRemnant: { glyph: "▨", label: "smashed door — a passable remnant (permanently breached)", color: INK.disabled },
  // A dropped key (D117/M5): a fallen keyholder's key on the board — step a unit onto it to carry, then turn the gate.
  key: { glyph: "⚷", label: "dropped key — step onto it to carry, then turn its gate", color: INK.gold },

  // --- UI affordances ---
  expand: { glyph: "▸", label: "expand" },
  collapse: { glyph: "▾", label: "collapse" },
  check: { glyph: "✓", label: "done", color: INK.success },
  warn: { glyph: "!", label: "in progress", color: INK.ember },
  // Objectives check-list markers (#137): a failed objective, and one still open.
  failed: { glyph: "✗", label: "failed", color: INK.danger },
  open: { glyph: "○", label: "in progress", color: INK.muted },

  // --- Resolution / after-action report ---
  spoils: { glyph: "¤", label: "spoils", color: INK.gold },
  loot: { glyph: "✸", label: "loot", color: INK.ember },
  levelUp: { glyph: "★", label: "level up", color: INK.gold },
  rescued: { glyph: "✓", label: "rescued", color: INK.success },
  fallen: { glyph: "†", label: "fallen", color: INK.ember },
  lost: { glyph: "✕", label: "lost forever", color: INK.danger },
  captive: { glyph: "!", label: "captured", color: INK.ember },
  recruited: { glyph: "✚", label: "recruited", color: INK.cyan },
  theft: { glyph: "$", label: "theft", color: INK.ember },
} as const satisfies Record<string, IconSpec>;

export type IconKey = keyof typeof ICON;

/**
 * Build a legend line straight from registry entries — the legend is *generated*,
 * never hand-typed, so it can never drift from the board (the bug that motivated
 * this). Render it in the UI font ({@link FONT.family}); the glyphs are safe there.
 */
export function legendLine(keys: readonly IconKey[], sep = "    "): string {
  return keys.map((k) => `${ICON[k].glyph} ${ICON[k].label}`).join(sep);
}

/**
 * Place a standalone icon marker — **the atlas seam**. v1 returns a Text glyph in
 * the bundled UI font (identical on every platform); when we adopt an icon atlas,
 * this is the *one* function that branches to `scene.add.image(frame)`, and the
 * call sites that go through it (board markers, etc.) don't change.
 */
export function placeIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: IconKey,
  opts: { size?: string; color?: string } = {},
): Phaser.GameObjects.Text {
  const spec: IconSpec = ICON[key];
  return scene.add
    .text(x, y, spec.glyph, {
      fontFamily: FONT.family,
      fontSize: opts.size ?? FONT.body,
      color: opts.color ?? spec.color ?? INK.secondary,
    })
    .setOrigin(0.5);
}
