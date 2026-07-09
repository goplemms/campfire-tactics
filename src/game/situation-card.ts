import Phaser from "phaser";
import { COLOR, FONT, INK } from "./theme";
import { MiniCard, type CardRow } from "./info-cards";
import {
  type RunState,
  type IntelReport,
  campReadout,
  currentEncounter,
  isAuthoredEncounter,
} from "../core";

export type CardView = "camp" | "intel";

/** The live read the situation card renders from — the scene hands a fresh one each refresh. */
export interface SituationCtx {
  run: RunState;
  phase: "deployment" | "battle" | "resolution";
  intel?: IntelReport;
  /** Morale's open-ground risk multiplier where it applies (deployment); 1 otherwise. */
  openRiskMultiplier: number;
}

/**
 * Compact the intel foe-type list for the HUD line: when every type shares a leading
 * word (a faction — "Bandit Thug", "Bandit Bowman"…), factor it out once
 * ("Bandit: Thug, Bowman, …") instead of repeating it per name. Falls back to a plain
 * join when there's no shared prefix (or a bare one-word type), so it never mangles a
 * mixed list. Display-only; the intel set itself is unchanged.
 */
function compactFoeTypes(types: readonly string[]): string {
  if (types.length < 2) return types.join(", ");
  const lead = types[0].split(" ")[0];
  const shareLead = types.every((t) => t.split(" ")[0] === lead && t.split(" ").length > 1);
  if (!shareLead) return types.join(", ");
  return `${lead}: ${types.map((t) => t.slice(lead.length).trim()).join(", ")}`;
}

/**
 * The top-right **situation card** (#131): a Camp ↔ Intel toggle over one {@link MiniCard}.
 * It shows the run's **camp** economy (morale / purse / storage) or the encounter **intel**
 * (foes / tier / shape / hazards / types), flipped by the two tabs forming the card's header
 * row. The component owns the card, the tab chips, and the active-view state; the scene hands
 * it a fresh {@link SituationCtx} on every {@link refresh} (via the `provider`), so the render
 * stays "data in". Renamed from `refreshCampText` (#138) — it renders Camp **or** Intel.
 */
export class SituationCard {
  private readonly card: MiniCard;
  private cardView: CardView = "intel";
  /** The Camp/Intel tab chips — restyled by {@link updateCardTabs}. */
  readonly tabs: { view: CardView; bg: Phaser.GameObjects.Rectangle; accent: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    private readonly provider: () => SituationCtx,
    private readonly onHint: (text: string) => void,
  ) {
    this.card = new MiniCard(scene, x, y, { w });
    // The Camp ↔ Intel toggle: two tab chips forming the card's header row, so it reads as a
    // switching-context area. The active chip is lighter, brighter, and gold-barred; the inactive
    // one recedes. The card title is left blank so the chips own the row.
    const tabH = 18, tabGap = 2;
    const tabW = (w - tabGap) / 2;
    this.makeCardTab(scene, "Camp", "camp", x, y, tabW, tabH);
    this.makeCardTab(scene, "Intel", "intel", x + tabW + tabGap, y, tabW, tabH);
  }

  /** The active view — exposed for the e2e harness (`s.cardView`). */
  get view(): CardView {
    return this.cardView;
  }

  /**
   * Re-render whichever view the toggle has active, then re-tint the tabs. Called wherever
   * camp economy *or* intel might have changed; cheap to re-render either side.
   */
  refresh(): void {
    const ctx = this.provider();
    if (this.cardView === "intel") this.renderIntelCard(ctx);
    else this.renderCampCard(ctx);
    this.updateCardTabs();
  }

  /** Flip to Camp or Intel and re-render (the tab click + the e2e `s.setCardView`). */
  setView(view: CardView): void {
    if (this.cardView === view) return;
    this.cardView = view;
    this.refresh();
  }

  /** Set the active view without rendering — the scene's per-phase default (a refresh follows). */
  resetView(view: CardView): void {
    this.cardView = view;
  }

  /**
   * The **camp** view (passive reference you can't change mid-mission — morale, purse, storage),
   * grouped out of the decision zone. Figures owned by core (`campReadout`); the camp-time levers
   * it omits (RP/Upkeep) live on the overworld camp where they're actually spent.
   */
  private renderCampCard(ctx: SituationCtx): void {
    const r = campReadout(ctx.run);
    // Attribute morale to its *effect* here (D-UX): in Deployment high morale trims the
    // capture risk on open (neutral) ground, so the otherwise-inert tier reads as
    // "High (−20% open risk)" — its mechanical pull legible where it lands, not a bare stat.
    const em = ctx.openRiskMultiplier;
    const morale = em < 1 ? `${r.moraleTier} (−${Math.round((1 - em) * 100)}% open risk)` : r.moraleTier;
    this.card.set("", [
      { label: "Morale", value: morale },
      { label: "Purse", value: `${r.purse}g` },
      { label: "Storage", value: `${r.storageUsed}/${r.storageCap}` },
    ]);
  }

  /**
   * The **intel** view (D10) — the scouted encounter: foe count, intel tier, and (in deployment,
   * where they inform placement) the field shape + a granted-vision flag, with the foe-type roster
   * as a wrapped note. The foes are on the board once battle joins, so this recedes to a recap.
   */
  private renderIntelCard(ctx: SituationCtx): void {
    const r = ctx.intel;
    if (!r) return void this.card.set("", [{ label: "Intel", value: "—" }]);
    const battle = ctx.phase === "battle";
    const def = currentEncounter(ctx.run);
    const shape = !battle && !isAuthoredEncounter(def) ? def.type : undefined;
    const rows: CardRow[] = [];
    if (r.count !== undefined) rows.push({ label: "Foes", value: `${r.count}` });
    rows.push({ label: "Intel", value: `T${r.tier}` });
    if (shape) rows.push({ label: "Field", value: shape });
    // The trap lane (D83): presence → count → the careless marks, where it informs placement.
    if (r.traps) {
      const t = r.traps;
      const marks = t.marked === undefined ? "" : t.marked > 0 ? ` · ${t.marked} marked` : " · none marked";
      rows.push({ label: "Hazards", value: !t.present ? "none sensed" : t.count === undefined ? "worked ground" : `${t.count} snares${marks}` });
    }
    if (!battle && r.grantsVision) rows.push({ label: "Vision", value: "yes" });
    const note = r.types && r.types.length ? compactFoeTypes(r.types) : undefined;
    this.card.set("", rows, undefined, note);
  }

  /** Build one Camp/Intel tab chip (bordered, with a top accent bar for the active state). */
  private makeCardTab(scene: Phaser.Scene, label: string, view: CardView, x: number, y: number, w: number, h: number): void {
    const bg = scene.add.rectangle(x, y, w, h, COLOR.surfaceRaised).setOrigin(0, 0).setStrokeStyle(1, COLOR.border).setDepth(12);
    const accent = scene.add.rectangle(x, y, w, 2, COLOR.accent).setOrigin(0, 0).setDepth(13).setVisible(false); // active-tab selection bar
    const text = scene.add.text(x + w / 2, y + h / 2 + 1, label, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0.5).setDepth(13);
    bg.setInteractive({ useHandCursor: true });
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.setView(view));
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.onHint(view === "intel" ? "Show the scouted foe intel." : "Show the camp economy (morale / purse / storage)."));
    this.tabs.push({ view, bg, accent, label: text });
  }

  /** Restyle the tab chips by the active view — active = lighter fill + bright text + gold bar. */
  private updateCardTabs(): void {
    for (const t of this.tabs) {
      const active = t.view === this.cardView;
      t.bg.setFillStyle(active ? COLOR.surfaceAlt : COLOR.surfaceRaised).setStrokeStyle(1, active ? COLOR.borderSoft : COLOR.border);
      t.label.setColor(active ? INK.bright : INK.muted);
      t.accent.setVisible(active);
    }
  }
}
