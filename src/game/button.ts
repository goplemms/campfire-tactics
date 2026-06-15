import Phaser from "phaser";
import { COLOR, FONT, INK } from "./theme";
import { fitText } from "./ui";

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
  hint?: ButtonHint;
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
  /** Animate hover/press juice — off under the screenshot harness for stable frames. */
  private readonly animate: boolean;
  private hovered = false;

  constructor(scene: Phaser.Scene, x: number, y: number, o: ButtonOptions) {
    super(scene, x, y);
    this.pad = o.pad ?? 10;
    this.animate = !(typeof window !== "undefined" && (window as Window & { __SHOT__?: boolean }).__SHOT__);
    this.bg = scene.add.rectangle(0, 0, o.w, o.h, o.fill).setStrokeStyle(o.strokeWidth ?? 2, o.stroke);
    this.label = scene.add.text(0, 0, o.text, { color: o.color ?? INK.onSuccess, fontFamily: FONT.family, fontSize: o.fontSize ?? FONT.body }).setOrigin(0.5);
    this.add([this.bg, this.label]);
    fitText(this.label, o.w - this.pad);

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
    if (o.hint) {
      const { bar, description, idle } = o.hint;
      if (description) {
        this.bg.on(Events.GAMEOBJECT_POINTER_OVER, () => bar.setText(description));
        this.bg.on(Events.GAMEOBJECT_POINTER_OUT, () => bar.setText(idle()));
      }
    }
  }

  /** Replace the label text and re-fit it to the button. Chainable. */
  setLabel(text: string): this {
    this.label.setText(text);
    fitText(this.label, this.bg.width - this.pad);
    return this;
  }

  /** Tween to a target scale, cancelling any scale tween already in flight. */
  private scaleTo(s: number): void {
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, scaleX: s, scaleY: s, duration: 90, ease: "Quad.Out" });
  }
}

export interface ColumnSpec {
  text: string;
  description?: string;
  onClick: () => void;
}

export interface ButtonColumnOptions {
  specs: ColumnSpec[];
  /** The x of the column's right edge; it grows leftward from here. */
  rightEdge: number;
  centerY: number;
  /** Width clamps: the column sizes to its widest label between these. */
  minW: number;
  maxW: number;
  fontSize?: string;
  /** Prefix each label with its `n. ` number-key hotkey (1–9). Default true. */
  hotkeys?: boolean;
  buttonFill?: number;
  buttonStroke?: number;
  panelFill?: number;
  panelStroke?: number;
  panelAlpha?: number;
  depth?: number;
  hintBar?: HintSink;
  idleHint?: () => string;
}

/**
 * A vertical command panel (FFT-style) that **sizes itself to its content**: it
 * measures its labels and widens—leftward from {@link ButtonColumnOptions.rightEdge}—
 * to fit the longest at full size, clamped to `[minW, maxW]`, rather than shrinking
 * the text. A faint backing groups the stack; new entries extend it downward.
 *
 * Owns its buttons and backing as a Container, so swapping panels is just
 * `this.panel?.destroy(); this.panel = new ButtonColumn(...)`. {@link actions}
 * exposes the per-button click handlers in order for number-key hotkeys.
 */
export class ButtonColumn extends Phaser.GameObjects.Container {
  readonly actions: (() => void)[] = [];

  constructor(scene: Phaser.Scene, o: ButtonColumnOptions) {
    super(scene, 0, 0);
    const fontSize = o.fontSize ?? FONT.label;
    const hotkeys = o.hotkeys ?? true;
    const h = 26;
    const step = 32;
    const padX = 8;
    const padY = 8;

    const labels = o.specs.map((s, i) => (hotkeys && i < 9 ? `${i + 1}. ${s.text}` : s.text));
    const widest = Math.max(0, ...labels.map((t) => probeWidth(scene, t, fontSize)));
    const w = Math.min(o.maxW, Math.max(o.minW, Math.ceil(widest) + 18));
    const cx = o.rightEdge - w / 2;
    const startY = o.centerY - ((o.specs.length - 1) * step) / 2;

    const bgH = (o.specs.length - 1) * step + h + padY * 2;
    this.add(
      scene.add
        .rectangle(cx, o.centerY, w + padX * 2, bgH, o.panelFill ?? COLOR.surface, o.panelAlpha ?? 0.6)
        .setStrokeStyle(1, o.panelStroke ?? COLOR.border),
    );
    o.specs.forEach((spec, i) => {
      this.add(
        new Button(scene, cx, startY + i * step, {
          text: labels[i],
          w,
          h,
          fill: o.buttonFill ?? COLOR.btnFill,
          stroke: o.buttonStroke ?? COLOR.btnStroke,
          fontSize,
          onClick: spec.onClick,
          hint: o.hintBar ? { bar: o.hintBar, description: spec.description, idle: o.idleHint ?? (() => "") } : undefined,
        }),
      );
      this.actions.push(spec.onClick);
    });
    this.setDepth(o.depth ?? 11);
    scene.add.existing(this);
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
