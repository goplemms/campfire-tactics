import Phaser from "phaser";
import { COLOR, FONT, INK } from "./theme";

const Events = Phaser.Input.Events;

export interface HintPanelOptions {
  /** Static command instructions for the body (empty → header reads just "Tips"). */
  keys?: string;
  /** Corner to dock against. "top" expands downward; "bottom" expands upward. */
  anchor?: "top" | "bottom";
  /** Top y for a top-anchored card (default 10). Ignored for bottom anchor. */
  top?: number;
  /** Start pinned open — for screens whose hint is feedback you want visible. */
  startPinned?: boolean;
}

/**
 * A collapsible info card that gives tips / command instructions one consistent
 * home. It docks in a screen corner and reveals its body two ways, no setting to
 * manage:
 *
 *   • **hover-peek** — pointing at the card expands it; moving away collapses it
 *     after a short grace delay. A contextual tip arriving (a button hover) also
 *     peeks it open so the tip is never shown into a collapsed void.
 *   • **click-pin** — clicking the header pins it open (or unpins) so it won't
 *     auto-collapse while you read or play.
 *
 * Collapsed it shrinks to just its header chip (right-anchored), so it clears even
 * a long centered scene title; it only grows to full width when expanded — an
 * opaque interaction state that's fine to overlap whatever's behind it. It can dock
 * top (expanding down) or bottom (expanding up) so each scene hosts it wherever its
 * layout has room.
 *
 * It satisfies the buttons' `{ setText }` hint sink, so it drops into the existing
 * Button / ButtonColumn wiring: on-hover passes a tip (peeks open), on-out restores
 * the resting hint (collapses if unpinned).
 */
export class HintPanel extends Phaser.GameObjects.Container {
  private readonly headerBg: Phaser.GameObjects.Rectangle;
  private readonly headerLabel: Phaser.GameObjects.Text;
  private readonly chevron: Phaser.GameObjects.Text;
  private readonly bodyBg: Phaser.GameObjects.Rectangle;
  private readonly tipText: Phaser.GameObjects.Text;
  private readonly keysText: Phaser.GameObjects.Text;
  private readonly baseLabel: string;
  private readonly hasKeys: boolean;
  private readonly bottom: boolean;

  private static readonly W = 244;
  private static readonly HEADER_H = 24;

  private resting = "";
  private pinned = false;
  private hovered = false;
  private tipActive = false;
  private isOpen = false;
  private collapseTimer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, opts: HintPanelOptions = {}) {
    const W = HintPanel.W;
    const keys = opts.keys ?? "";
    const bottom = opts.anchor === "bottom";
    // Right-anchored: the card's right edge sits 10px from the screen edge; it grows
    // leftward within this W-wide span. A bottom anchor docks its bottom edge near
    // the screen bottom and grows upward.
    super(scene, scene.scale.width - 10 - W, bottom ? scene.scale.height - 8 : opts.top ?? 10);
    this.bottom = bottom;
    this.hasKeys = keys.length > 0;
    this.baseLabel = this.hasKeys ? "Tips & Keys" : "Tips";

    this.bodyBg = scene.add.rectangle(0, 0, W, 10, COLOR.surface, 0.96).setStrokeStyle(1, COLOR.borderSoft).setOrigin(0, 0);
    this.tipText = scene.add.text(10, 0, "", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption, align: "left", lineSpacing: 3, wordWrap: { width: W - 20 } }).setOrigin(0, 0);
    this.keysText = scene.add.text(10, 0, keys, { color: INK.disabled, fontFamily: FONT.family, fontSize: FONT.micro, wordWrap: { width: W - 20 } }).setOrigin(0, 0);
    this.headerBg = scene.add.rectangle(0, 0, W, HintPanel.HEADER_H, COLOR.surfaceAlt, 0.96).setStrokeStyle(1, COLOR.borderSoft).setOrigin(0, 0);
    this.headerLabel = scene.add.text(0, 0, this.baseLabel, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5);
    this.chevron = scene.add.text(0, 0, "▸", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(1, 0.5);

    this.add([this.bodyBg, this.tipText, this.keysText, this.headerBg, this.headerLabel, this.chevron]);
    this.setDepth(15);
    scene.add.existing(this);

    // Hover + pin live on both bars so moving header↔body doesn't drop the hover.
    for (const r of [this.headerBg, this.bodyBg]) {
      r.setInteractive({ useHandCursor: true });
      r.on(Events.GAMEOBJECT_POINTER_OVER, () => this.onOver());
      r.on(Events.GAMEOBJECT_POINTER_OUT, () => this.onOut());
      r.on(Events.GAMEOBJECT_POINTER_DOWN, () => this.togglePin());
    }

    this.pinned = opts.startPinned ?? false;
    if (this.pinned) this.headerLabel.setText(`${this.baseLabel} · pinned`);
    this.apply(this.pinned);
  }

  /** The resting hint (set by the scene's setHint). Shown when no transient tip is up. */
  setResting(text: string): this {
    this.resting = text;
    if (!this.tipActive) this.setTipText(text);
    return this;
  }

  /**
   * The buttons' hint sink. A tip that differs from the resting hint is transient
   * (peek open); restoring the resting text ends the tip (collapse if unpinned).
   */
  setText(text: string): this {
    if (text === this.resting) {
      this.tipActive = false;
      this.setTipText(this.resting);
      this.scheduleCollapse();
    } else {
      this.tipActive = true;
      this.setTipText(text);
      this.expand();
    }
    return this;
  }

  /**
   * Drop any transient tip and fall back to the resting hint. Call this when the
   * thing that raised a tip goes away mid-hover (e.g. a hovered button is destroyed
   * on a panel rebuild) — its pointer-out never fires, so the tip would stick.
   */
  clearTip(): this {
    if (this.tipActive) {
      this.tipActive = false;
      this.setTipText(this.resting);
      this.scheduleCollapse();
    }
    return this;
  }

  /** Swap the tip text and, if the card is open, re-fit the body to the new height. */
  private setTipText(text: string): void {
    this.tipText.setText(text);
    if (this.isOpen) this.apply(true);
  }

  private onOver(): void {
    this.hovered = true;
    this.expand();
  }

  private onOut(): void {
    this.hovered = false;
    this.scheduleCollapse();
  }

  private togglePin(): void {
    this.pinned = !this.pinned;
    this.headerLabel.setText(this.pinned ? `${this.baseLabel} · pinned` : this.baseLabel);
    if (this.pinned) this.expand();
    else this.scheduleCollapse();
  }

  private expand(): void {
    this.collapseTimer?.remove();
    this.collapseTimer = undefined;
    this.apply(true);
  }

  /** Collapse after a grace delay, unless something still wants it open. */
  private scheduleCollapse(): void {
    this.collapseTimer?.remove();
    this.collapseTimer = this.scene.time.delayedCall(320, () => {
      this.collapseTimer = undefined;
      if (!this.pinned && !this.hovered && !this.tipActive) this.apply(false);
    });
  }

  /** Lay out for the open/closed state: full width open, a right-anchored chip closed. */
  private apply(expanded: boolean): void {
    this.isOpen = expanded;
    this.chevron.setText(expanded ? "▾" : this.bottom ? "▴" : "▸");
    this.headerBg.setStrokeStyle(1, this.pinned ? COLOR.info : COLOR.borderSoft);

    const W = HintPanel.W;
    const hH = HintPanel.HEADER_H;
    // Collapsed: shrink the header to fit its label and pin it to the right edge.
    const wc = expanded ? W : Math.min(W, Math.ceil(this.headerLabel.width) + 30);
    const hx = W - wc;
    // The header is the docked strip; the body grows away from the anchored edge —
    // below the header for a top anchor, above it for a bottom anchor.
    const bodyH = 9 + this.tipText.height + (this.hasKeys ? 7 + this.keysText.height : 0) + 8;
    const headerY = this.bottom ? -hH : 0;
    const bodyTop = this.bottom ? -hH - bodyH : hH;

    this.headerBg.setSize(wc, hH).setPosition(hx, headerY);
    this.headerLabel.setPosition(hx + 8, headerY + hH / 2);
    this.chevron.setPosition(W - 7, headerY + hH / 2);

    this.bodyBg.setVisible(expanded);
    this.tipText.setVisible(expanded);
    this.keysText.setVisible(expanded && this.hasKeys);
    if (!expanded) return;

    this.bodyBg.setSize(W, bodyH).setPosition(0, bodyTop);
    this.tipText.setPosition(10, bodyTop + 9);
    if (this.hasKeys) this.keysText.setPosition(10, this.tipText.y + this.tipText.height + 7);
  }
}
