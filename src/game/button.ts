import Phaser from "phaser";
import { FONT, INK } from "./theme";
import { fitText, isScreenshotMode } from "./ui";

const Events = Phaser.Input.Events;

/** Hover grows the button a touch; a press dips it — small but lively feedback. */
const HOVER_SCALE = 1.05;
const PRESS_SCALE = 0.95;

/** Anything that can receive hint text — a plain Phaser.Text bar or the richer
 *  HintPanel. Kept minimal so buttons stay decoupled from how a scene shows hints. */
export interface HintSink {
  setText(text: string): unknown;
}

/** Hover-hint wiring: while the pointer is over the button, the sink shows
 *  `description`; on out it restores to whatever `idle()` reports (the scene's
 *  current resting hint). Omit for buttons that have no hint sink. */
export interface ButtonHint {
  bar: HintSink;
  description?: string;
  idle: () => string;
}

export interface ButtonOptions {
  text: string;
  /** Button rectangle size. */
  w: number;
  h: number;
  fill: number;
  stroke: number;
  onClick: () => void;
  /** Label font size (a {@link FONT} px string). Defaults to {@link FONT.body}. */
  fontSize?: string;
  color?: string;
  strokeWidth?: number;
  /** Inner horizontal padding subtracted before fitting the label. Default 10. */
  pad?: number;
  /** Brighten the fill on hover. Default true. */
  hover?: boolean;
  /** Label alignment: "left" pins the label to the left edge (inset by pad/2); default centered. */
  align?: "left" | "center";
  /** When false the button is inert — no hand cursor, hover, or click (a disabled action). Default true. */
  enabled?: boolean;
  hint?: ButtonHint;
  /**
   * Extra pointer-over / pointer-out hooks — fired **regardless of `enabled`** (like
   * {@link hint}), so a greyed row can still drive a hint/preview that explains the grey.
   * The scene-side wiring the camp/nav rows used to hand-roll (a hint bar write, an
   * action-effect preview) becomes these two callbacks.
   */
  onHover?: () => void;
  onOut?: () => void;
}

/**
 * A canvas button as a single reusable component: a rectangle with a centered
 * label that always fits (via {@link fitText}, which also flags over-budget
 * labels), brighten-on-hover, an optional hint-bar binding, and click handling.
 *
 * It's a {@link Phaser.GameObjects.Container} so it moves, hides, and—crucially—
 * destroys as one unit (no more tracking `bg` and `label` separately in each
 * scene). Pointer handlers live on the background rectangle, whose origin-centered
 * hit area lines up exactly with the centered children, sidestepping the
 * top-left hit-area quirk of an interactive Container.
 *
 * The caller owns placement on the display list: `scene.add.existing(btn)` for a
 * standalone button, or `column.add(btn)` to nest it (see {@link ButtonColumn}).
 */
export class Button extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  private readonly pad: number;
  /** The untruncated label text — kept so a width change can re-fit from the original (fitText's
   *  ellipsis is destructive, so re-fitting the current text could never recover it). */
  private fullText: string;
  /** Animate hover/press juice — off under the screenshot harness for stable frames. */
  private readonly animate: boolean;
  private hovered = false;

  constructor(scene: Phaser.Scene, x: number, y: number, o: ButtonOptions) {
    super(scene, x, y);
    this.pad = o.pad ?? 10;
    this.animate = !isScreenshotMode();
    this.fullText = o.text;
    this.bg = scene.add.rectangle(0, 0, o.w, o.h, o.fill).setStrokeStyle(o.strokeWidth ?? 2, o.stroke);
    this.label = scene.add.text(0, 0, o.text, { color: o.color ?? INK.onSuccess, fontFamily: FONT.family, fontSize: o.fontSize ?? FONT.body }).setOrigin(0.5);
    // Left-aligned labels pin to the left edge, inset by half the pad (matching the
    // hall's `x + pad/2` list rows); the default keeps the label centered.
    if (o.align === "left") this.label.setOrigin(0, 0.5).setX(-o.w / 2 + this.pad / 2);
    this.add([this.bg, this.label]);
    fitText(this.label, o.w - this.pad);

    // A disabled button renders inert: no hit area, hand cursor, hover, or click —
    // the caller supplies the greyed fill/stroke/colour. The hint + hover hooks still
    // wire (a greyed row explains its grey on hover), matching the hand-rolled camp rows.
    if (o.enabled === false) {
      if (o.hint) this.wireHint(o.hint);
      this.wireHover(o);
      return;
    }

    this.bg.setInteractive({ useHandCursor: true });
    const lit = Phaser.Display.Color.IntegerToColor(o.fill).brighten(18).color;
    const brighten = o.hover !== false;
    // Click fires on press-down, with a quick dip so the tap registers; hover grows
    // and brightens. POINTER_OUT also undoes a press in case the pointer drags off.
    this.bg.on(Events.GAMEOBJECT_POINTER_DOWN, () => {
      if (this.animate) this.setScale(PRESS_SCALE);
      o.onClick();
    });
    this.bg.on(Events.GAMEOBJECT_POINTER_UP, () => {
      if (this.animate) this.scaleTo(this.hovered ? HOVER_SCALE : 1);
    });
    this.bg.on(Events.GAMEOBJECT_POINTER_OVER, () => {
      this.hovered = true;
      if (brighten) this.bg.setFillStyle(lit);
      if (this.animate) this.scaleTo(HOVER_SCALE);
    });
    this.bg.on(Events.GAMEOBJECT_POINTER_OUT, () => {
      this.hovered = false;
      if (brighten) this.bg.setFillStyle(o.fill);
      if (this.animate) this.scaleTo(1);
    });
    if (o.hint) this.wireHint(o.hint);
    this.wireHover(o);
  }

  /** Bind the caller's extra pointer-over / pointer-out hooks (hint bar write, effect preview). */
  private wireHover(o: ButtonOptions): void {
    if (o.onHover) this.bg.on(Events.GAMEOBJECT_POINTER_OVER, o.onHover);
    if (o.onOut) this.bg.on(Events.GAMEOBJECT_POINTER_OUT, o.onOut);
  }

  /** Bind the hover-hint sink: show `description` while hovered, restore `idle()` on out. */
  private wireHint(hint: ButtonHint): void {
    const { bar, description, idle } = hint;
    if (description) {
      this.bg.on(Events.GAMEOBJECT_POINTER_OVER, () => bar.setText(description));
      this.bg.on(Events.GAMEOBJECT_POINTER_OUT, () => bar.setText(idle()));
    }
  }

  /** Replace the label text and re-fit it to the button. Chainable. */
  setLabel(text: string): this {
    this.fullText = text;
    this.label.setText(text);
    fitText(this.label, this.bg.width - this.pad);
    return this;
  }

  /**
   * Resize the button's width, re-fitting the label and refreshing the hit area so the
   * clickable region tracks the new size (a persistent button the layout reflows — e.g.
   * the End Turn primary going full-width ↔ half-width when it pairs with Undo). Chainable.
   */
  setWidth(w: number): this {
    this.bg.setSize(w, this.bg.height);
    this.label.setText(this.fullText); // restore the original before re-fitting (ellipsis is one-way)
    fitText(this.label, w - this.pad);
    // Resize the existing hit area in place (the documented way). Re-creating it via
    // removeInteractive()/setInteractive() drops the clickable region for this container-child
    // shape — the button still fired on its keyboard shortcut but no longer on a mouse click.
    const ha = this.bg.input?.hitArea;
    if (ha instanceof Phaser.Geom.Rectangle) ha.setTo(0, 0, w, this.bg.height);
    return this;
  }

  /** Tween to a target scale, cancelling any scale tween already in flight. */
  private scaleTo(s: number): void {
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, scaleX: s, scaleY: s, duration: 90, ease: "Quad.Out" });
  }
}


/**
 * Natural (unscaled) pixel width of a label at a given font size — used to size a
 * panel to its content. Phaser bakes font metrics per Text object, so this spins
 * up a throwaway, measures, and disposes it.
 */
export function probeWidth(scene: Phaser.Scene, text: string, fontSize: string): number {
  const probe = scene.add.text(0, 0, text, { fontFamily: FONT.family, fontSize }).setVisible(false);
  const w = probe.width;
  probe.destroy();
  return w;
}
