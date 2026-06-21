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
 * An always-on, horizontal **board colour key** — the persistent twin of the full
 * `L` legend, so the green/amber/red wash language is self-teaching without a
 * keypress. It's a thin shared component, not a phase-specific one: each scene/phase
 * just calls {@link setItems} with the swatches that match what it paints, so the
 * **same key, in the same corner** carries across Deployment and Battle (and any
 * future scene that washes tiles).
 *
 * Docked bottom-left by default — clear of the centred action row and the
 * bottom-right session log — it lays its items left-to-right and sizes itself to the
 * content. Empty items hide it entirely (e.g. during a resolution overlay).
 */
export class LegendStrip extends Phaser.GameObjects.Container {
  /** Swatch edge length (a small square), and the gap rules around it. */
  private static readonly SWATCH = 11;
  private static readonly GAP = 6; // swatch → label
  private static readonly PAD = 16; // item → item

  private objs: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, x = 12, y = scene.scale.height - 98) {
    // Docked low-left but *above* the centred action row (≈ height − 66) so the key
    // never runs under the End Turn / verb buttons, and clear of the board's lower
    // vertex and the bottom-right session log.
    super(scene, x, y);
    this.setDepth(11);
    scene.add.existing(this);
  }

  /** Replace the key with `items` (or clear it when empty). Re-lays out from the left. */
  setItems(items: LegendItem[]): this {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    const s = LegendStrip.SWATCH;
    let cx = 0;
    for (const item of items) {
      const swatch = item.outline
        ? this.scene.add.rectangle(cx, 0, s, s).setStrokeStyle(2, item.color, item.alpha ?? 1).setOrigin(0, 0.5)
        : this.scene.add.rectangle(cx, 0, s, s, item.color, item.alpha ?? 1).setStrokeStyle(1, item.color, 1).setOrigin(0, 0.5);
      const text = this.scene.add
        .text(cx + s + LegendStrip.GAP, 0, item.label, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption })
        .setOrigin(0, 0.5);
      this.add([swatch, text]);
      this.objs.push(swatch, text);
      cx += s + LegendStrip.GAP + text.width + LegendStrip.PAD;
    }
    this.setVisible(items.length > 0);
    return this;
  }
}

/** Swatch alphas chosen to match the board washes the key stands in for. */
export const LEGEND_ALPHA = { wash: 0.5, outline: 1 } as const;

/** The Deployment closing-net key (D63): safe ground, the ring about to fall, danger. */
export const DEPLOY_LEGEND: LegendItem[] = [
  { color: COLOR.successDeep, label: "Safe by the fire", alpha: LEGEND_ALPHA.wash },
  { color: COLOR.accent, label: "Warning — falls next turn", alpha: LEGEND_ALPHA.wash },
  { color: COLOR.danger, label: "Danger — may capture", alpha: LEGEND_ALPHA.wash },
];

/** The Battle key (D60): move budget, where a strike lands, the toggled threat zone. */
export const BATTLE_LEGEND: LegendItem[] = [
  { color: COLOR.reach, label: "Move range", alpha: LEGEND_ALPHA.wash },
  { color: COLOR.threat, label: "In strike range", outline: true },
  { color: COLOR.danger, label: "Threat zone (T)", alpha: LEGEND_ALPHA.wash },
];
