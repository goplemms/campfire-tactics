import Phaser from "phaser";
import { COLOR, INK } from "./theme";
import { Button } from "./button";
import type { HintPanel } from "./hint-panel";
import { clearLayer } from "./ui";

/** One entry in the bottom-left command row — a labelled button with an optional tooltip. */
export type ActionSpec = { text: string; description?: string; onClick: () => void; enabled?: boolean };

/** Command-menu geometry (the bottom-left stacked action box) — shared so the docked
 *  primary and the verb stack agree on width/pitch/anchor. */
export const MENU_BW = 150;
export const MENU_BH = 28;
export const MENU_PITCH = 31;
export const MENU_PAD = 7;
export const MENU_LEFT = 12; // box left margin
export const MENU_CX = MENU_LEFT + MENU_PAD + MENU_BW / 2; // button centre x (bottom-left)
export const MENU_GAP = 12; // vertical gap between the verb box and the turn-control box below it
export const PAIR_GAP = 6; // horizontal gap between Undo and the primary in the control box's bottom row

/**
 * The bottom-left **command menu** (#131): a layout engine over `ActionSpec[]` + the green
 * turn primary. It owns the two stacked, bordered boxes (the unit's **verbs** on top, a
 * separate **turn-control** box below) and the primary's docking/half-width pairing with
 * Undo. Its inputs are pure — spec rows in, buttons out — so the scene's spec-builders
 * (`refreshDeployButtons` / `showSkillButtons`) hand it `ActionSpec[]` and it renders them
 * identically in either phase. The scene owns lifecycle: it constructs one menu in `create`
 * and drives it through thin delegators.
 */
export class CommandMenu {
  /** The green End Turn / Advance Clock primary — docked into the control box or resting alone. */
  readonly primary: Button;
  /** The two stacked boxes + their buttons, torn down and rebuilt on every {@link layout}. */
  readonly buttons: Phaser.GameObjects.GameObject[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hintPanel: HintPanel,
    /** The scene's current resting hint — read lazily so a button's out-hover restores it live. */
    private readonly idleHint: () => string,
    onPrimary: () => void,
  ) {
    this.primary = this.makeTextButton(MENU_CX, scene.scale.height - 40, MENU_BW, MENU_BH, "", COLOR.successDeep, COLOR.success, onPrimary);
    this.primary.setDepth(12);
  }

  makeTextButton(x: number, y: number, w: number, h: number, text: string, fill: number, stroke: number, onClick: () => void, description?: string, enabled = true): Button {
    const btn = new Button(this.scene, x, y, {
      text,
      w,
      h,
      // A disabled button renders greyed + inert (no click/hover/cursor) but keeps its
      // hover-hint, so an unavailable control stays a visible, self-explaining affordance.
      fill: enabled ? fill : COLOR.surfaceRaised,
      stroke: enabled ? stroke : COLOR.border,
      color: enabled ? undefined : INK.disabled,
      enabled,
      onClick,
      hint: { bar: this.hintPanel, description, idle: this.idleHint },
    });
    this.scene.add.existing(btn).setDepth(12);
    return btn;
  }

  setPrimary(text: string, visible = true): void {
    // Fit the label at *full* width first: a long label (e.g. "Advance Clock") set while the
    // primary is still half-width (paired with Undo on the turn just ended) would over-fit and
    // ellipsize. The control-box layout re-narrows to half afterward for the short "End Turn".
    this.primary.setWidth(MENU_BW).setLabel(text).setVisible(visible);
  }

  /** The resting Y of the End Turn / Advance Clock primary — the box's bottom slot. */
  private primaryRestY(): number {
    return this.scene.scale.height - 40;
  }

  clear(): void {
    clearLayer(this.buttons);
    // With no command menu up, the primary (End Turn / Advance Clock / …) stands alone,
    // bottom-left at full width; layout re-docks (and may halve) it as needed.
    this.primary?.setWidth(MENU_BW).setPosition(MENU_CX, this.primaryRestY());
  }

  /**
   * Lay the command menu as **two** stacked boxes docked **bottom-left** (D-UX): the
   * unit's **verbs** on top, and a separate **turn-control** box below it, with a
   * {@link MENU_GAP} between them. "What this unit does" reads apart from "control the
   * turn/clock". The control box stacks any full-width `controls` rows (e.g. Start
   * Battle) above a **bottom row** that pairs **Undo** side-by-side with the green End
   * Turn / Advance Clock primary (equal halves) — or the primary alone, full width, when
   * there's nothing to take back. Undo is only ever live *during* a player turn, so it
   * only pairs with **End Turn** (never the between-turns Advance Clock). Shared by both
   * phases and the herb submenu (which passes verbs only). Boxes are tracked with the
   * buttons; {@link clear} tears them down and floats the primary back to its lone,
   * full-width resting spot.
   */
  layout(verbs: ActionSpec[], opts: { undo?: ActionSpec; controls?: ActionSpec[] } = {}): void {
    this.clear();
    const dockPrimary = this.primary.visible;
    const controls = opts.controls ?? [];
    const hasCluster = dockPrimary || controls.length > 0 || !!opts.undo;
    const clusterTopEdge = hasCluster
      ? this.drawControlBox(controls, opts.undo, dockPrimary)
      : this.primaryRestY() + MENU_BH / 2 + MENU_PAD; // nothing below — verbs take the bottom
    if (verbs.length > 0) {
      const verbsBottomY = hasCluster ? clusterTopEdge - MENU_GAP - MENU_BH / 2 - MENU_PAD : this.primaryRestY();
      this.drawMenuBox(verbs, verbsBottomY, false);
    }
  }

  /**
   * Draw the bottom-left **turn-control box**: `controls` (full-width rows, e.g. Start
   * Battle) stacked above a bottom row that pairs {@link undo} with the docked primary as
   * equal halves (or the primary alone, full width, when there's no `undo`). Returns the
   * box's **top edge** Y so the verb box can stack above it.
   */
  private drawControlBox(controls: ActionSpec[], undo: ActionSpec | undefined, dockPrimary: boolean): number {
    const cx = MENU_CX;
    const bottomY = this.primaryRestY();
    const rows = controls.length + (dockPrimary || undo ? 1 : 0); // +1 for the bottom Undo/primary row
    const topY = bottomY - (Math.max(rows, 1) - 1) * MENU_PITCH;
    this.buttons.push(
      this.scene.add
        .rectangle(cx, (topY + bottomY) / 2, MENU_BW + 2 * MENU_PAD, (Math.max(rows, 1) - 1) * MENU_PITCH + MENU_BH + 2 * MENU_PAD, COLOR.surface, 0.85)
        .setStrokeStyle(1, COLOR.borderSoft)
        .setDepth(11),
    );
    // Full-width control rows (Start Battle …) above the bottom Undo/primary row.
    controls.forEach((spec, i) => {
      this.buttons.push(this.makeTextButton(cx, topY + i * MENU_PITCH, MENU_BW, MENU_BH, spec.text, COLOR.btnFill, COLOR.btnStroke, spec.onClick, spec.description));
    });
    // Bottom row: Undo | primary side-by-side (equal halves), or the primary alone. Undo
    // renders greyed/inert when `enabled === false` (a visible-but-disabled affordance).
    if (undo && dockPrimary) {
      const half = (MENU_BW - PAIR_GAP) / 2;
      this.buttons.push(this.makeTextButton(cx - (half + PAIR_GAP) / 2, bottomY, half, MENU_BH, undo.text, COLOR.btnFill, COLOR.btnStroke, undo.onClick, undo.description, undo.enabled !== false));
      this.primary.setWidth(half).setPosition(cx + (half + PAIR_GAP) / 2, bottomY);
    } else if (undo) {
      this.buttons.push(this.makeTextButton(cx, bottomY, MENU_BW, MENU_BH, undo.text, COLOR.btnFill, COLOR.btnStroke, undo.onClick, undo.description, undo.enabled !== false));
    } else if (dockPrimary) {
      this.primary.setWidth(MENU_BW).setPosition(cx, bottomY);
    }
    return topY - MENU_BH / 2 - MENU_PAD;
  }

  /**
   * Draw one stacked, bordered box of buttons whose **bottom button centre** sits at
   * `bottomY`. When `dockPrimary`, the green primary takes the box's bottom slot and the
   * specs stack above it. Returns the box's **top edge** Y so a caller can stack another
   * box above it.
   */
  private drawMenuBox(specs: ActionSpec[], bottomY: number, dockPrimary: boolean): number {
    const cx = MENU_CX;
    const slots = specs.length + (dockPrimary ? 1 : 0);
    if (slots === 0) return bottomY - MENU_BH / 2 - MENU_PAD;
    const topY = bottomY - (slots - 1) * MENU_PITCH;
    const box = this.scene.add
      .rectangle(cx, (topY + bottomY) / 2, MENU_BW + 2 * MENU_PAD, (slots - 1) * MENU_PITCH + MENU_BH + 2 * MENU_PAD, COLOR.surface, 0.85)
      .setStrokeStyle(1, COLOR.borderSoft)
      .setDepth(11);
    this.buttons.push(box);
    specs.forEach((spec, i) => {
      this.buttons.push(this.makeTextButton(cx, topY + i * MENU_PITCH, MENU_BW, MENU_BH, spec.text, COLOR.btnFill, COLOR.btnStroke, spec.onClick, spec.description));
    });
    if (dockPrimary) this.primary.setPosition(cx, topY + specs.length * MENU_PITCH);
    return topY - MENU_BH / 2 - MENU_PAD;
  }
}
