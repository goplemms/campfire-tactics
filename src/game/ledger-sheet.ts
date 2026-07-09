/**
 * The **ledger sheet** (D45/D48) — the run's gold-flow accounting, drawn into a
 * `bounds` rectangle: a Balance/Influence header, the category rows (each line with
 * its amount, skip-strike + checkbox on Upkeep lines), and the forecasted balance
 * bookend. Shared by its two hosts — the Captain's Tent ledger tab and the night-end
 * {@link "./scenes/OverworldScene".OverworldScene.showLedgerTransition | ledger transition}.
 *
 * **Data in / intent out** (the {@link "./party-dossier-view".PartyDossierView} line): the
 * host builds the {@link Ledger} from core and passes it in; the sheet never mutates the run —
 * crossing an Upkeep line off fires the `onToggleSkip` intent and hover text goes to `onHint`.
 * It draws onto the host's overlay `layer` (the overlay-card idiom — {@link "./overlay-card"}),
 * so the host's existing `clearLayer` tears it down at the same lifecycle points; the two hosts
 * already own that layer.
 */

import Phaser from "phaser";
import { COLOR, FONT, INK } from "./theme";
import type { Ledger, UpkeepLine } from "../core";

export interface LedgerSheetOptions {
  /** The rectangle the sheet lays out inside. */
  bounds: Phaser.Geom.Rectangle;
  /** The built ledger (from core `buildLedger`) — the sheet only lays it out. */
  ledger: Ledger;
  /** Intent: the player crossed an Upkeep line off / restored it. The host owns the core write + redraw. */
  onToggleSkip: (id: UpkeepLine["id"]) => void;
  /** Hover-hint sink — the scene's resting-hint bar. */
  onHint: (text: string) => void;
  /** Read-only sheet (the rest tiers force-pay Upkeep, so its lines aren't crossable). Default true. */
  interactive?: boolean;
}

/** A signed gold figure for the ledger (`+5g` / `-5g`). */
export function signedGold(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}g`;
}

/**
 * The ledger sheet itself (D45/D48) — Balance/Influence header, the category rows, and the
 * forecasted balance — drawn into `o.bounds` onto `layer`. `o.onToggleSkip` fires when an
 * Upkeep line is crossed off; `o.interactive: false` makes the sheet read-only.
 */
export function drawLedgerSheet(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.GameObject[],
  o: LedgerSheetOptions,
): void {
  const b = o.bounds;
  const ledger = o.ledger;
  const pad = 22;
  const leftX = b.left + pad;
  const rightX = b.right - pad;
  const colX = rightX - 86;
  const rowH = 22;
  const g = scene.add.graphics().setDepth(24);
  layer.push(
    g,
    scene.add.text(leftX, b.top + 10, `Balance  ${ledger.balance}g`, { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
    scene.add.text(rightX, b.top + 10, `Influence ${ledger.influence} · never pays Upkeep`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
  );
  g.lineStyle(1, COLOR.borderSoft, 0.9);
  g.lineBetween(leftX, b.top + 24, rightX, b.top + 24);
  g.lineBetween(leftX, b.top + 26, rightX, b.top + 26);

  let y = drawLedgerRows(scene, layer, ledger, g, { leftX, rightX, colX, rowH, cx: b.centerX, pad, w: b.width }, b.top + 26 + 18, o);
  // Forecasted balance — the estimated purse carried into tomorrow (current balance after
  // tonight's projected Upkeep/Banker). A bottom-line bookend to the top Balance; a rule
  // sets it apart from the category rows.
  y += 4;
  g.lineStyle(1, COLOR.borderSoft, 0.9);
  g.lineBetween(leftX, y, rightX, y);
  y += 14;
  layer.push(
    scene.add.text(leftX, y, "Forecasted balance  · into tomorrow", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
    scene.add.text(rightX, y, `${ledger.forecastBalance}g`, { color: ledger.forecastBalance < 0 ? INK.danger : INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(1, 0.5).setDepth(25),
  );
  // The route forecast (runway + per-edge) is planning, not accounting — it lives on the
  // Survey panel, so the ledger stops at its own bottom line.
}

/**
 * The category/line rows — the bulk of the ledger sheet: each category header
 * (label + running total), its lines (amount, skip-strike, faint per-row rule),
 * the clickable hit-rects on Upkeep lines, and the vertical amount-column rule.
 * Draws onto the shared graphics `g`; returns the `y` just past the last row.
 */
function drawLedgerRows(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.GameObject[],
  ledger: Ledger,
  g: Phaser.GameObjects.Graphics,
  geom: { leftX: number; rightX: number; colX: number; rowH: number; cx: number; pad: number; w: number },
  startY: number,
  o: LedgerSheetOptions,
): number {
  const { leftX, rightX, colX, rowH, cx, pad, w } = geom;
  let y = startY;
  const rowsTop = y - rowH / 2;
  for (const cat of ledger.categories) {
    // Category header row (label + running total, both in gold).
    const tag = cat.projected ? "  (projected)" : "";
    // The total figure reads red when it's an outflow (Upkeep's drain, a net field spend) —
    // the same red-for-negative convention the individual line amounts use; the label stays
    // gold as the section marker. This is where the "burn" now lives (the text is gone).
    layer.push(
      scene.add.text(leftX, y, `${cat.label}${tag}`, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
      scene.add.text(rightX, y, signedGold(cat.total), { color: cat.total < 0 ? INK.danger : INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(1, 0.5).setDepth(25),
    );
    g.lineStyle(1, COLOR.border, 0.5);
    g.lineBetween(leftX, y + rowH / 2, rightX, y + rowH / 2);
    y += rowH;

    for (const l of cat.lines) {
      const skipped = l.note === "voluntarily skipped";
      const skippable = (o.interactive ?? true) && cat.id === "upkeep"; // only Upkeep lines are skippable, and only when the surface allows it
      const labelInk = skipped ? INK.disabled : skippable ? INK.bright : INK.secondary;
      layer.push(
        scene.add.text(leftX + 18, y, l.label, { color: labelInk, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
      );
      // The amount on the right stays even when crossed off (D45) — dimmed and struck (below),
      // it's not in the total, but it tells the player what restoring the line would cost. A
      // skipped line's `amount` is 0 (out of the total), so show its `restoreAmount` instead.
      const shownAmount = skipped ? l.restoreAmount ?? l.amount : l.amount;
      layer.push(
        scene.add.text(rightX, y, signedGold(shownAmount), { color: skipped ? INK.disabled : shownAmount < 0 ? INK.danger : INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
      );
      // Strike the row through when crossed off — from the label (leftX + 18), so the
      // checkbox in the indent gutter stays legible rather than being slashed through.
      if (skipped) {
        g.lineStyle(1.5, COLOR.danger, 0.85);
        g.lineBetween(leftX + 18, y, rightX, y);
      }
      // Faint per-entry rule (ledger paper).
      g.lineStyle(1, COLOR.border, 0.28);
      g.lineBetween(leftX + 12, y + rowH / 2, rightX, y + rowH / 2);

      // Upkeep rows are clickable: cross off (skip) / restore. The hit rect sits
      // below the text (depth 24) so its hover wash reads behind the ink.
      if (skippable) {
        // A checkbox in the indent gutter makes the "you can cross this off" affordance
        // obvious at a glance (D45): checked (gold box + tick) = the expense stands;
        // unchecked (empty box) + the strike above = crossed off.
        const boxSize = 12;
        const boxX = leftX;
        const boxY = y - boxSize / 2;
        g.lineStyle(1.2, skipped ? COLOR.borderSoft : COLOR.gold, skipped ? 0.7 : 0.95);
        g.strokeRect(boxX, boxY, boxSize, boxSize);
        if (!skipped) {
          g.lineStyle(1.8, COLOR.success, 1);
          g.lineBetween(boxX + 2.5, boxY + 6.5, boxX + 5, boxY + 9);
          g.lineBetween(boxX + 5, boxY + 9, boxX + 9.5, boxY + 3);
        }
        const lineId = l.id.replace("upkeep:", "") as UpkeepLine["id"];
        const hit = scene.add.rectangle(cx, y, w - 2 * pad + 12, rowH, COLOR.surfaceAlt, 0).setDepth(24).setInteractive({ useHandCursor: true });
        hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
          hit.setFillStyle(COLOR.surfaceAlt, 0.35);
          o.onHint(skipped ? `Click to restore ${l.label} to the ledger (fund it again).` : `Click to cross ${l.label} off the ledger — frees its gold; you'll take the consequence and the gate won't nag.`);
        });
        hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => hit.setFillStyle(COLOR.surfaceAlt, 0));
        hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => o.onToggleSkip(lineId));
        layer.push(hit);
      }
      y += rowH;
    }
  }

  // The vertical amount-column rule down the rows region.
  g.lineStyle(1, COLOR.borderSoft, 0.45);
  g.lineBetween(colX, rowsTop, colX, y - rowH / 2);
  return y;
}
