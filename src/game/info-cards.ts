import Phaser from "phaser";
import { COLOR, FONT, INK, WEIGHT } from "./theme";
import { hpColor, hex } from "./unit-readout";

/**
 * One label→value line in a {@link MiniCard}. `emphasize` promotes the value to a
 * bold heading (the decision-driving figure — e.g. a capture risk); `color` tints
 * it (danger/success/muted) so a glance reads the state, not just the number.
 */
export interface CardRow {
  label: string;
  value: string;
  color?: string;
  emphasize?: boolean;
}

/**
 * A small docked **info card** — the shared frame behind the HUD's "grouped by use"
 * zones (D-UX): a titled, self-sizing panel of label→value rows, optionally led by
 * an HP bar. The same component renders the left-column **active-unit focus** card
 * (who's acting + their decision figures) and the **camp-state** card (passive
 * reference you can't change mid-mission), so the two zones read as siblings.
 *
 * Dumb on purpose: the scene computes *what* to show (risk, bands, attribution) and
 * passes rows in; the card only lays them out. Re-`set` it whenever the data changes.
 */
export class MiniCard extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly hpNumText?: Phaser.GameObjects.Text;
  private readonly hpBarBg?: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill?: Phaser.GameObjects.Rectangle;
  private rowObjs: Phaser.GameObjects.GameObject[] = [];
  private readonly cardW: number;
  private readonly withHp: boolean;

  constructor(scene: Phaser.Scene, x: number, y: number, opts: { w?: number; hp?: boolean } = {}) {
    super(scene, x, y);
    this.cardW = opts.w ?? 158;
    this.withHp = !!opts.hp;
    this.bg = scene.add.rectangle(0, 0, this.cardW, 22, COLOR.surface, 0.9).setOrigin(0, 0).setStrokeStyle(1, COLOR.borderSoft);
    this.titleText = scene.add.text(8, 6, "", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0);
    this.add([this.bg, this.titleText]);
    if (this.withHp) {
      // Absolute HP on the title row, right-aligned (e.g. "18/20") — the bar shows the
      // ratio at a glance, the number the exact margin. Tinted by fraction like the bar.
      this.hpNumText = scene.add.text(this.cardW - 8, 6, "", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(1, 0);
      this.hpBarBg = scene.add.rectangle(8, 0, this.cardW - 16, 4, COLOR.bg).setOrigin(0, 0.5);
      this.hpBarFill = scene.add.rectangle(8, 0, this.cardW - 16, 4, COLOR.success).setOrigin(0, 0.5);
      this.add([this.hpBarBg, this.hpBarFill, this.hpNumText]);
    }
    this.setDepth(11);
    scene.add.existing(this);
  }

  /**
   * Replace the card's content and re-fit its height. `hp` draws the bar when enabled;
   * `cur`/`max`, when given, also print the absolute HP on the title row.
   */
  set(title: string, rows: CardRow[], hp?: { frac: number; cur?: number; max?: number }): this {
    this.titleText.setText(title);
    for (const o of this.rowObjs) o.destroy();
    this.rowObjs = [];
    let y = 24;
    if (this.withHp && this.hpBarBg && this.hpBarFill) {
      const show = hp !== undefined;
      this.hpBarBg.setVisible(show);
      this.hpBarFill.setVisible(show);
      if (show) {
        const frac = Math.max(0, Math.min(1, hp.frac));
        this.hpBarBg.setPosition(8, y);
        this.hpBarFill.setPosition(8, y).setSize((this.cardW - 16) * frac, 4).setFillStyle(hpColor(frac));
        y += 10;
        const num = hp.cur !== undefined && hp.max !== undefined ? `${hp.cur}/${hp.max}` : "";
        this.hpNumText?.setText(num).setColor(hex(hpColor(frac))).setVisible(num !== "");
      } else {
        this.hpNumText?.setVisible(false);
      }
    }
    for (const r of rows) {
      const big = r.emphasize === true;
      const label = this.scene.add
        .text(8, y, r.label, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption })
        .setOrigin(0, 0);
      const value = this.scene.add
        .text(this.cardW - 8, y, r.value, {
          color: r.color ?? INK.secondary,
          fontFamily: FONT.family,
          fontSize: big ? FONT.heading : FONT.caption,
          fontStyle: big ? WEIGHT.bold : WEIGHT.regular,
        })
        .setOrigin(1, big ? 0.2 : 0);
      this.add([label, value]);
      this.rowObjs.push(label, value);
      y += big ? 19 : 15;
    }
    this.bg.setSize(this.cardW, y + 4);
    this.setVisible(true);
    return this;
  }

  hide(): this {
    this.setVisible(false);
    return this;
  }
}
