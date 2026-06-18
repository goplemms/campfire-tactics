/**
 * Shared unit-readout atomics — the HP-bar colour ramp and the per-status pip data
 * the battle board and the party dossier both draw, named once so the two surfaces
 * read identically (a wounded unit looks the same in camp as on the grid).
 *
 * Pure helpers over a {@link Unit}; the construction of the actual Phaser objects
 * stays with each surface (a pooled board token vs. a dossier list row lay out
 * differently), but the *logic* — what colour, what glyphs — lives here.
 */

import { statusVisual, type Unit } from "../core";
import { COLOR } from "./theme";

/** A numeric `0xRRGGBB` colour as a Phaser/CSS `#rrggbb` string (for Text fills). */
export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** HP-bar fill colour by remaining fraction: green > 0.5, gold > 0.25, else red. */
export function hpColor(frac: number): number {
  return frac > 0.5 ? COLOR.success : frac > 0.25 ? COLOR.gold : COLOR.danger;
}

/** One status badge as glyph(+finite duration) and colour — the data a pip renders. */
export interface Pip {
  text: string;
  color: string;
}

/**
 * A unit's per-status pips: each active status as `glyph + turns-left` tinted per
 * status. Board-positional pseudo-statuses (the flank pip) are **not** here — they
 * mean nothing off the grid; the battle view appends them itself.
 */
export function statusPips(unit: Unit): Pip[] {
  return unit.statuses.map((st) => {
    const v = statusVisual(st.id);
    const dur = Number.isFinite(st.duration) ? `${st.duration}` : "";
    return { text: `${v.glyph}${dur}`, color: hex(v.tint) };
  });
}
