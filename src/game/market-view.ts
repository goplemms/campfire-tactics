/**
 * The **Market overlay** (D61) — the gated supply shop drawn over the current beat. Buy trap kits +
 * the Medic's herbs in bulk (a +/− stepper per row, capped by gold), and sell looted salvage — all
 * at the node's effective market tier. Access (a market node or a Merchant) is the gate; with none
 * it shows why and offers only Close. Mirrors the Tent overlay's frame/teardown so the two read as
 * siblings.
 *
 * **Data in / intent out** (the overlay-card line): the run + the node come in; the view never
 * mutates the run — buying / selling fire the host's `onBuy` / `onSellAll` intents (which run the
 * core verbs + re-render), the steppers write the host's live `marketQty` and `rerender`, and Close
 * fires `onClose`. It draws onto the host's overlay `layer` (torn down by the host's clearLayer).
 */

import { COLOR, FONT, INK } from "./theme";
import { clearLayer } from "./ui";
import { installBackdrop, type ButtonFactory } from "./overlay-card";
import {
  effectiveMarketTier,
  merchantPrice,
  marketStock,
  sellPrice,
  getMaterial,
  countOf,
  canAdd,
  slotsFor,
  slotsUsed,
  projectManifest,
  type RunState,
  type MapNode,
} from "../core";

export interface MarketViewOptions {
  run: RunState;
  /** The node whose market tier gates the shop (`campNode ?? currentNode`). */
  node: MapNode;
  /** The per-item buy quantity the +/− steppers drive (the host owns it; the steppers write it). */
  marketQty: Record<string, number>;
  /** The caravan's vessel caps (for the purse/storage footer's manifest). */
  caravan: { vesselLabel?: string; partyCapacity?: number };
  /** The scene's button factory (its depth + hint wiring). */
  make: ButtonFactory;
  /** Intent: buy `qty` of `id` at the node's tier. */
  onBuy: (id: string, qty: number) => void;
  /** Intent: sell the whole valuables stack. */
  onSellAll: () => void;
  /** Intent: close the market. */
  onClose: () => void;
  /** Re-draw the market (after a stepper writes `marketQty`). */
  rerender: () => void;
}

/** (Re)draw the Market overlay into `layer`. Clears `layer` first (it owns the overlay's lifetime). */
export function drawMarket(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.GameObject[],
  o: MarketViewOptions,
): void {
  clearLayer(layer);
  const run = o.run;
  const tier = effectiveMarketTier(o.node, run.party);
  const cx = scene.scale.width / 2;
  const cy = scene.scale.height / 2;
  const w = 560;
  const h = 400;
  const left = cx - w / 2;
  const top = cy - h / 2;

  installBackdrop(scene, layer, 22);
  layer.push(
    scene.add.rectangle(cx, cy, w, h, COLOR.surface, 0.98).setStrokeStyle(2, COLOR.gold).setDepth(23),
    scene.add.text(left + 24, top + 24, "Market", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0, 0.5).setDepth(25),
    scene.add.text(left + 122, top + 26, `· ${tier === "none" ? "no market" : `${tier} market`}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
  );
  layer.push(o.make(left + w - 60, top + 26, 96, 28, "Close", COLOR.surfaceRaised, COLOR.border, () => o.onClose()).setDepth(26));
  // Storage on the header so the space you're spending is visible while you shop — buys eat
  // slots (see each row's Space) and a full stash blocks them, so surface the cap up front.
  const invUsed = slotsUsed(run.inventory);
  layer.push(scene.add.text(left + w - 24, top + 52, `Storage ${invUsed}/${run.inventory.storageCap} (free ${run.inventory.storageCap - invUsed})`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25));

  const leftX = left + 24;
  if (tier === "none") {
    layer.push(scene.add.text(leftX, top + 80, "No market here — route to a market node, or bring a Merchant to open one anywhere.", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 4, wordWrap: { width: w - 48 } }).setOrigin(0, 0).setDepth(25));
    return;
  }

  const price = merchantPrice(tier);
  let y = top + 64;
  layer.push(scene.add.text(leftX, y, `Buy  ·  ${price}g each`, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
  y += 28;
  for (const id of marketStock()) {
    const mat = getMaterial(id);
    if (!mat) continue;
    const owned = countOf(run.inventory, id);
    const room = canAdd(run.inventory, id);
    const affordable = Math.floor(run.camp.gold / price);
    const buyable = room && affordable >= 1;
    layer.push(
      scene.add.text(leftX, y, mat.name, { color: buyable ? INK.bright : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
      scene.add.text(leftX + 150, y, `own ${owned}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
    );
    if (!buyable) {
      layer.push(scene.add.text(leftX + 244, y, room ? `need ${price}g` : "storage full", { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(25));
    } else {
      const qty = Math.min(affordable, Math.max(1, o.marketQty[id] ?? 1));
      // Space this purchase will add (stacks pack, so buying into a partial stack can add 0) —
      // the "how much room am I about to spend" readout, live with the stepper.
      const addSlots = slotsFor(mat, owned + qty) - slotsFor(mat, owned);
      layer.push(scene.add.text(leftX + 200, y, `Space: +${addSlots}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(25));
      layer.push(o.make(leftX + 268, y, 22, 22, "−", COLOR.surfaceRaised, COLOR.border, () => { o.marketQty[id] = Math.max(1, qty - 1); o.rerender(); }).setDepth(26));
      layer.push(scene.add.text(leftX + 292, y, `${qty}`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5, 0.5).setDepth(25));
      layer.push(o.make(leftX + 316, y, 22, 22, "+", COLOR.surfaceRaised, COLOR.border, () => { o.marketQty[id] = Math.min(affordable, qty + 1); o.rerender(); }).setDepth(26));
      layer.push(o.make(leftX + 392, y, 84, 22, `Buy ×${qty}`, COLOR.btnFill, COLOR.gold, () => o.onBuy(id, qty)).setDepth(26));
    }
    y += 30;
  }

  y += 8;
  layer.push(scene.add.text(leftX, y, "Sell", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
  y += 28;
  const valCount = countOf(run.inventory, "valuables");
  const unitSell = sellPrice(getMaterial("valuables")!, tier);
  if (valCount > 0 && unitSell > 0) {
    layer.push(scene.add.text(leftX, y, `Valuables  ·  ×${valCount} at ${unitSell}g each`, { color: INK.bright, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
    layer.push(o.make(leftX + 392, y, 84, 22, "Sell all", COLOR.btnFill, COLOR.gold, () => o.onSellAll()).setDepth(26));
  } else {
    layer.push(scene.add.text(leftX, y, valCount === 0 ? "No salvage to sell." : "Salvage can't be sold here.", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
  }

  const m = projectManifest(run, o.caravan);
  layer.push(scene.add.text(leftX, top + h - 22, `Purse ${m.purse}g     ·     Storage ${m.storageUsed}/${m.storageCap}`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
}
