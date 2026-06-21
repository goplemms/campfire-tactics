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

  // --- Combat board + status (registry is complete; combat-view migration is a follow-up) ---
  charging: { glyph: "◷", label: "charging" },
  lethal: { glyph: "†", label: "lethal" },
  flank: { glyph: "‡", label: "flanked" },
  trapArmed: { glyph: "▲", label: "trap (armed)", color: INK.danger },
  trapSprung: { glyph: "✕", label: "trap (sprung)", color: INK.disabled },
  trapMine: { glyph: "✸", label: "your trap", color: INK.ember },

  // --- UI affordances ---
  expand: { glyph: "▸", label: "expand" },
  collapse: { glyph: "▾", label: "collapse" },
  check: { glyph: "✓", label: "done", color: INK.success },
  warn: { glyph: "!", label: "in progress", color: INK.ember },

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
