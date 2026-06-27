import Phaser from "phaser";
import { COLOR, FONT, INK } from "./theme";

/** One key entry: a coloured swatch and what it means on the board. */
export interface LegendItem {
  /** Swatch fill colour (`0xRRGGBB`). */
  color: number;
  /** The short meaning shown beside the swatch. */
  label: string;
  /** Swatch fill alpha — match the on-board wash so the key reads as the real thing. */
  alpha?: number;
  /** Draw the swatch as a hollow outline instead of a fill (e.g. a strike ring). */
  outline?: boolean;
}

/**
 * An always-on **board colour key** — the persistent twin of the full `L` legend, so
 * the green/amber/red wash language is self-teaching without a keypress. It's a thin
 * shared component, not a phase-specific one: each scene/phase just calls
 * {@link setItems} with the swatches that match what it paints, so the **same key, in
 * the same corner** carries across Deployment and Battle (and any future scene that
 * washes tiles).
 *
 * Positioned by the caller (BattleScene docks it along the bottom, just right of the
 * command box), stacked vertically and anchored by its **bottom edge** so it grows
 * upward from there — keeping the bottom-right column clear for the combat log and the
 * Session-log chip. Sizes itself to its items; an empty list hides it (e.g. under a
 * resolution overlay).
 */
export class LegendStrip extends Phaser.GameObjects.Container {
  /** Swatch edge length (a small square), the swatch→label gap, and the row pitch. */
  private static readonly SWATCH = 11;
  private static readonly GAP = 6; // swatch → label
  private static readonly ROW = 16; // row → row

  private objs: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, x = scene.scale.width - 198, y = scene.scale.height - 56) {
    // Bottom-right, with the container's y as the *bottom* row's centre: rows stack
    // upward from here, so the block grows up and never runs under the Session-log
    // chip (fixed at the very bottom-right corner) or the centred action row.
    super(scene, x, y);
    this.setDepth(11);
    scene.add.existing(this);
  }

  /** Replace the key with `items` (or clear it when empty). Stacks them bottom-up. */
  setItems(items: LegendItem[]): this {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    const s = LegendStrip.SWATCH;
    const n = items.length;
    items.forEach((item, i) => {
      // First item on top, last flush with the bottom anchor (relative y 0).
      const ry = -(n - 1 - i) * LegendStrip.ROW;
      const swatch = item.outline
        ? this.scene.add.rectangle(0, ry, s, s).setStrokeStyle(2, item.color, item.alpha ?? 1).setOrigin(0, 0.5)
        : this.scene.add.rectangle(0, ry, s, s, item.color, item.alpha ?? 1).setStrokeStyle(1, item.color, 1).setOrigin(0, 0.5);
      const text = this.scene.add
        .text(s + LegendStrip.GAP, ry, item.label, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption })
        .setOrigin(0, 0.5);
      this.add([swatch, text]);
      this.objs.push(swatch, text);
    });
    this.setVisible(n > 0);
    return this;
  }
}

/** Swatch alphas chosen to match the board washes the key stands in for. */
export const LEGEND_ALPHA = { wash: 0.5, outline: 1 } as const;

/** The Deployment closing-net key (D63/D-feel): the immune core, risky open ground, the net. */
export const DEPLOY_LEGEND: LegendItem[] = [
  { color: COLOR.successDeep, label: "Safe core — no capture", alpha: LEGEND_ALPHA.wash },
  { color: COLOR.danger, label: "Open ground — risk", alpha: 0.22 },
  { color: COLOR.accent, label: "Net falls here next", alpha: LEGEND_ALPHA.wash },
  { color: COLOR.danger, label: "The net — capture", alpha: LEGEND_ALPHA.wash },
];

/** The Battle key (D60): move budget, where a strike lands, the toggled threat zone. */
export const BATTLE_LEGEND: LegendItem[] = [
  { color: COLOR.reach, label: "Move range", alpha: LEGEND_ALPHA.wash },
  { color: COLOR.threat, label: "In strike range", outline: true },
  { color: COLOR.danger, label: "Threat zone (T)", alpha: LEGEND_ALPHA.wash },
];
