import Phaser from "phaser";
import { COLOR, DEPTH, FONT, INK } from "./theme";
import type { Button } from "./button";

/**
 * The one modal/overlay-card component (#133). Six scene sites hand-rolled the same
 * rect + stroke + title + body + button card — with per-site drift, the worst being
 * that only *some* installed the full-screen input-swallowing backdrop (the D75 bug
 * class: "without it the camp bled through around the box"). This centralizes the
 * frame so every modal reads one code path and **always** gets the backdrop.
 *
 * `showModal` draws the backdrop (unless opted out) + box + title + optional body,
 * and returns a {@link ModalHandle} so a caller can add its own content (choice
 * buttons, a ledger sheet) with the frame's resolved geometry. {@link renderChoicePanel}
 * folds the two ~identical event-choice panels (early + event) into one.
 *
 * Dumb on purpose: the scene owns *what* a modal says and does; this owns the frame.
 */

/** Box stroke + title-ink pairing by intent — the modal's mood in one word. */
export const MODAL_TONE = {
  /** A good outcome / orientation. */
  good: { stroke: COLOR.success, title: INK.success },
  /** A loss / warning / hard gate. */
  bad: { stroke: COLOR.danger, title: INK.danger },
  /** A neutral choice surface (events). */
  info: { stroke: COLOR.info, title: INK.secondary },
  /** An economy / accounting surface. */
  gold: { stroke: COLOR.gold, title: INK.gold },
  /** A plain reference panel (the legend). */
  neutral: { stroke: COLOR.btnStroke, title: INK.primary },
} as const;

export type ModalTone = keyof typeof MODAL_TONE;

/** A button factory the modal uses so each scene keeps its own button wiring (depth, hint sink). */
export type ButtonFactory = (
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  fill: number,
  stroke: number,
  onClick: () => void,
) => Button;

/**
 * The body copy under the title. Fully explicit geometry so each migrated site
 * reproduces byte-for-byte: `originX === 0` pins the text to the box's left edge
 * (inset by {@link padX}); otherwise it centres at the box centre-x. `originY` and
 * `textAlign` are independent (a centred block of left-aligned lines is a real case).
 */
export interface ModalBody {
  text: string;
  /** Y of the body, measured from the box top edge. */
  offset: number;
  /** Horizontal origin: 0 pins to the left edge (inset by {@link padX}); 0.5 (default) centres at cx. */
  originX?: number;
  /** Vertical origin (default 0.5). */
  originY?: number;
  /** Text alignment inside the block (default: left-pinned → "left", centred → "center"). */
  textAlign?: "left" | "center";
  color?: string;
  /** Font px string (default {@link FONT.body}). */
  font?: string;
  lineSpacing?: number;
  /** Centred word-wrap width = box width − this inset (default 60). Ignored when left-pinned. */
  wrapInset?: number;
  /** Left-pin inset from the box edge; also sets the left-pinned wrap width to w − 2·padX (default 24). */
  padX?: number;
  /** Skip word-wrap entirely (pre-wrapped bodies — the legend). */
  noWrap?: boolean;
}

export interface ModalOptions {
  title: string;
  tone?: ModalTone;
  body?: ModalBody;
  /** Box width / height. */
  w: number;
  h: number;
  /** The box centre Y (caller owns the vertical placement quirks: −20 / −10 / centred). */
  cy: number;
  /** Box centre X — defaults to the scene centre. */
  cx?: number;
  boxFill?: number;
  boxAlpha?: number;
  /** Title Y from the box top edge (default 24). */
  titleOffset?: number;
  titleSize?: string;
  /** Title alignment: "left" pins it to the box's left edge (inset 24, the sheet-header
   *  style — market/ledger); default centres at cx. */
  titleAlign?: "center" | "left";
  /** Base depth: box sits here, backdrop at depth−1, title/body at depth+1. Default 20. */
  depth?: number;
  /** Install the full-screen input-swallowing backdrop. Default **true** (#133's fix). */
  backdrop?: boolean;
}

/** Geometry + a `contentTop` handed back so a caller can add bespoke content below the title. */
export interface ModalHandle {
  cx: number;
  cy: number;
  top: number;
  left: number;
  w: number;
  h: number;
  depth: number;
}

/**
 * Install the full-screen, click-swallowing backdrop (dims the scene, blocks input to
 * whatever is behind the modal). Pushed onto `layer` so the scene's clear pass tears it
 * down with the rest of the overlay. The single source of the D75 fix.
 */
export function installBackdrop(scene: Phaser.Scene, layer: Phaser.GameObjects.GameObject[], depth: number): Phaser.GameObjects.Rectangle {
  const backdrop = scene.add
    .rectangle(scene.scale.width / 2, scene.scale.height / 2, scene.scale.width, scene.scale.height, COLOR.black, 0.55)
    .setDepth(depth)
    .setInteractive();
  layer.push(backdrop);
  return backdrop;
}

/**
 * Draw a modal card frame — backdrop + box + title + optional body — into `layer`, and
 * return its geometry. The caller adds any buttons/content with the returned handle.
 */
export function showModal(scene: Phaser.Scene, layer: Phaser.GameObjects.GameObject[], o: ModalOptions): ModalHandle {
  const cx = o.cx ?? scene.scale.width / 2;
  const cy = o.cy;
  const { w, h } = o;
  const top = cy - h / 2;
  const left = cx - w / 2;
  const depth = o.depth ?? DEPTH.modal;
  const tone = MODAL_TONE[o.tone ?? "neutral"];

  if (o.backdrop !== false) installBackdrop(scene, layer, depth - 1);

  const title = scene.add
    .text(cx, top + (o.titleOffset ?? 24), o.title, { color: tone.title, fontFamily: FONT.family, fontSize: o.titleSize ?? FONT.display })
    .setOrigin(0.5)
    .setDepth(depth + 1);
  if (o.titleAlign === "left") title.setOrigin(0, 0.5).setX(left + 24);
  layer.push(
    scene.add
      .rectangle(cx, cy, w, h, o.boxFill ?? COLOR.bg, o.boxAlpha ?? 0.96)
      .setStrokeStyle(2, tone.stroke)
      .setDepth(depth),
    title,
  );

  const b = o.body;
  if (b) {
    const leftPinned = b.originX === 0;
    const padX = b.padX ?? 24;
    const bx = leftPinned ? left + padX : cx;
    const textAlign = b.textAlign ?? (leftPinned ? "left" : "center");
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      color: b.color ?? INK.secondary,
      fontFamily: FONT.family,
      fontSize: b.font ?? FONT.body,
      align: textAlign,
      lineSpacing: b.lineSpacing ?? 4,
    };
    if (!b.noWrap) style.wordWrap = { width: leftPinned ? w - 2 * padX : w - (b.wrapInset ?? 60) };
    layer.push(
      scene.add
        .text(bx, top + b.offset, b.text, style)
        .setOrigin(leftPinned ? 0 : 0.5, b.originY ?? 0.5)
        .setDepth(depth + 1),
    );
  }

  return { cx, cy, top, left, w, h, depth };
}

/** One vertically-stacked choice in a modal (event options, discard rows). */
export interface ModalChoice {
  label: string;
  onPick: () => void;
  /** Default true. A disabled choice greys and its click is a no-op (owned by the caller). */
  enabled?: boolean;
  fill?: number;
  stroke?: number;
  /** Hover detail routed to `onHint`. */
  detail?: string;
}

/** Layout for a vertical button stack in a modal. */
export interface ChoiceStackOptions {
  choices: ModalChoice[];
  /** Y of the first button, from the box top edge. */
  startOffset: number;
  step: number;
  btnW: number;
  btnH: number;
  make: ButtonFactory;
  /** Depth override for the buttons (default handle.depth + 2). */
  buttonDepth?: number;
  /** Hover-detail sink. */
  onHint?: (text: string) => void;
}

/**
 * Render a vertical stack of choice buttons into `layer`, using the caller's button
 * factory (so scene-specific depth/hint wiring is preserved). Returns the Y (from the
 * box top) just past the last button — a caller can add a trailing button (e.g. a
 * shop's "Leave") at that offset.
 */
export function renderChoiceStack(
  layer: Phaser.GameObjects.GameObject[],
  handle: ModalHandle,
  o: ChoiceStackOptions,
): number {
  let offset = o.startOffset;
  for (const c of o.choices) {
    const enabled = c.enabled ?? true;
    const fill = c.fill ?? (enabled ? COLOR.btnFill : COLOR.surfaceRaised);
    const stroke = c.stroke ?? (enabled ? COLOR.info : COLOR.border);
    const btn = o.make(handle.cx, handle.top + offset, o.btnW, o.btnH, c.label, fill, stroke, () => {
      if (enabled) c.onPick();
    });
    if (o.buttonDepth !== undefined) btn.setDepth(o.buttonDepth);
    if (c.detail && o.onHint) btn.bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => o.onHint!(c.detail!));
    layer.push(btn);
    offset += o.step;
  }
  return offset;
}
