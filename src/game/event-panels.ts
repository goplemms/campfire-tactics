/**
 * The **event choice panel** (M11/D80) — the shared modal the road's event flows raise: an
 * early-road event or an event node (shop / recruiter / story) offering one button per choice.
 * A titled info card with a `${body}\nPurse Ng` subhead, one button per option, and an optional
 * trailing row (a shop's explicit Leave). Folds the two once-~90%-identical panels (#133) onto
 * batch A's {@link "./overlay-card".showModal} + {@link "./overlay-card".renderChoiceStack}.
 *
 * **Dumb on purpose** (the overlay-card line): the scene owns *what* the event says and does —
 * it passes the choices + the intent callbacks; this owns only the frame + the stack.
 */

import { COLOR, FONT, INK } from "./theme";
import { clearLayer } from "./ui";
import { showModal, renderChoiceStack, type ButtonFactory } from "./overlay-card";
import type { EventChoice } from "../core";

export interface EventChoicePanelOptions {
  title: string;
  body: string;
  /** The purse figure for the subhead (`… Purse Ng`). */
  gold: number;
  choices: EventChoice[];
  /** Intent: the taken (available) option. */
  onPick: (choice: EventChoice) => void;
  btnW: number;
  /** A trailing button (a shop's explicit Leave). */
  extraRow?: { label: string; onPick: () => void };
  /** The scene's button factory (its depth + hint wiring). */
  make: ButtonFactory;
  /** Hover-detail sink (the scene's resting-hint bar). */
  onHint: (text: string) => void;
}

/**
 * The shared event-choice modal (#133) — a titled info card with a `${body}\nPurse Ng` subhead
 * and one button per choice; `onPick` fires for the taken (available) option. `extraRow` appends a
 * trailing button. Always backdropped. Clears `layer` first (it owns the modal for its lifetime).
 */
export function renderChoicePanel(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.GameObject[],
  o: EventChoicePanelOptions,
): void {
  const w = 560;
  const rows = o.choices.length + (o.extraRow ? 1 : 0);
  const bodyText = `${o.body}\nPurse ${o.gold}g`;

  // The body is variable-length — some events run several sentences — so size the card to
  // it rather than to a fixed height. A long body used to grow up into the title and
  // overprint it (its default vertical origin centred the block on a fixed offset). Measure
  // the wrapped body, top-anchor it just below the display-size title, and start the choice
  // stack below the body so nothing collides regardless of copy length.
  const bodyTop = 54; // clears the 22px title centred at top+24
  const bodyH = measureWrappedHeight(scene, bodyText, w - 60); // w − 60 = showModal's centred-body wrap width
  const choicesStart = bodyTop + bodyH + 18;
  const h = choicesStart + rows * 40 + 14;

  clearLayer(layer);
  const handle = showModal(scene, layer, {
    title: o.title,
    tone: "info",
    w,
    h,
    cy: scene.scale.height / 2 - 20,
    body: { text: bodyText, offset: bodyTop, originY: 0, color: INK.muted },
  });
  const endOffset = renderChoiceStack(layer, handle, {
    choices: o.choices.map((c) => ({ label: c.label, enabled: c.available, detail: c.detail, onPick: () => o.onPick(c) })),
    startOffset: choicesStart,
    step: 40,
    btnW: o.btnW,
    btnH: 30,
    make: o.make,
    onHint: o.onHint,
  });
  if (o.extraRow) {
    layer.push(o.make(handle.cx, handle.top + endOffset, o.btnW, 30, o.extraRow.label, COLOR.successDeep, COLOR.success, o.extraRow.onPick));
  }
}

/**
 * The rendered height of `text` once word-wrapped to `wrapWidth`, via a throwaway
 * (invisible, immediately destroyed) measuring Text. Matches {@link showModal}'s centred-body
 * style (font/lineSpacing/align) so the measured height equals what it will draw — letting
 * the caller lay out the title, body, and buttons without any pair overlapping.
 */
function measureWrappedHeight(scene: Phaser.Scene, text: string, wrapWidth: number): number {
  const probe = scene.add
    .text(0, 0, text, { fontFamily: FONT.family, fontSize: FONT.body, align: "center", lineSpacing: 4, wordWrap: { width: wrapWidth } })
    .setVisible(false);
  const h = probe.height;
  probe.destroy();
  return h;
}
