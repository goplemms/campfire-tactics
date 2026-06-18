import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import {
  RunLoop,
  previewNode,
  slotsUsed,
  countOf,
  moraleTier,
  // M8 — the overworld action economy (D35)
  getAbility,
  cooldownRemaining,
  scoutedTier,
  fatigueTier,
  fatiguePenalty,
  unitSkills,
  useCampJobSkill,
  addItem,
  triageHeal,
  chunkHp,
  runDifficulty,
  combatRoster,
  // M10 — the gold economy verbs (D30/D34) + theft (D30)
  merchantBuy,
  bankerEngageInterest,
  bankerBorrow,
  bankerProtect,
  collectPoliticalIncome,
  ECONOMY,
  // M11 — the data-driven event-node registry (D4/D23)
  eventForNode,
  storyForNode,
  // M13 — the overworld economic layer (D45/D46/D47/D48)
  currentNode,
  visibleNodes,
  projectForecast,
  buildLedger,
  nightEndGate,
  computeUpkeep,
  type RunState,
  type MapNode,
  type NodePreview,
  type RestResult,
  type InPlaceRestResult,
  type EventOutcome,
  type EventChoice,
  type EventKind,
  type Unit,
  type OverworldAbility,
  type ActionResult,
  type SkillDef,
  type Guild,
  type Ledger,
  type RouteForecast,
  type UpkeepLine,
} from "../../core";
import { fitText } from "../ui";
import { Button } from "../button";
import { HintPanel } from "../hint-panel";
import { ICON, legendLine, placeIcon, type IconKey } from "../icons";

/** Data handed between the overworld and a combat node's BattleScene. */
export interface RunHandoff {
  run: RunState;
  loop: RunLoop;
  /** The owning guild (M9) — threaded so a terminal can return to the hall. */
  guild?: Guild;
  /** The caravan whose run this is — the hall resolves it on a terminal (D27). */
  caravanId?: string;
  /** Show the one-time Expedition-demo intro overlay before the map (M13 demo). */
  demoIntro?: boolean;
}

/**
 * The **overworld** screen — the seeded, branching run map (D22) and, since M8,
 * the **unified overworld camp** (D35). It owns the run + {@link RunLoop} and is
 * the screen the player returns to between missions: it draws the layered node DAG,
 * highlights the **reachable** nodes, and previews each with banded intel (D24).
 *
 * **M8 — camp at every node (D35).** Choosing a node no longer plays it straight
 * away; it opens **one unified camp** (the title callback) where the player takes
 * **overworld actions** — gated by per-ability **node-step cooldowns** (the spine)
 * and per-character **fatigue** (a loose guardrail) — then **commits**. This folds
 * the old separate Meta-phase screen in: the camp's meta skills (Chef/Merchant),
 * provisioning and triage now live here, alongside the new overworld economy. A
 * **combat** node's commit hands off to {@link "./BattleScene"} (Deployment → Battle
 * → Resolution, unchanged downstream); a **rest** node recovers in place and
 * **restores fatigue** (D23/D35). On a wipe it shows the **run-end** screen (seed
 * for replay); on clearing the final node, a **run complete** screen. It owns no
 * rules — every decision flows through the loop.
 */
export class OverworldScene extends Phaser.Scene {
  private run!: RunState;
  private loop!: RunLoop;
  private guild?: Guild;
  private caravanId?: string;
  /** One-shot Expedition-demo intro flag (cleared after it shows once). */
  private demoIntro = false;

  private graph?: Phaser.GameObjects.Graphics;
  private nodePos = new Map<string, { x: number; y: number }>();
  private nodeObjects: Phaser.GameObjects.GameObject[] = [];
  private overlay: Phaser.GameObjects.GameObject[] = [];

  // The unified overworld camp (D35): objects + the node currently camped at.
  private campObjects: Phaser.GameObjects.GameObject[] = [];
  private campNode?: MapNode;
  /** Camp progressive disclosure (D58): the optional Banker/Noble/Market economy is
   *  collapsed by default so the everyday camp reads as a few obvious actions. */
  private campAdvanced = false;

  private titleText!: Phaser.GameObjects.Text;
  private campText!: Phaser.GameObjects.Text;
  private previewText!: Phaser.GameObjects.Text;
  private hintPanel!: HintPanel;

  constructor() {
    super("OverworldScene");
  }

  /** Resume data: an in-flight run+loop (from the hall, or back from a BattleScene). */
  init(data?: Partial<RunHandoff>): void {
    this.run = data?.run as RunState;
    this.loop = data?.loop as RunLoop;
    this.guild = data?.guild;
    this.caravanId = data?.caravanId;
    this.demoIntro = data?.demoIntro ?? false;
  }

  create(): void {
    // The New Guild button returns to the hall (M9 — the guild owns runs now).
    const newRunBtn = document.getElementById("newrun") as HTMLButtonElement | null;
    if (newRunBtn) newRunBtn.onclick = () => this.scene.start("GuildScene");

    // The overworld is now ONE caravan's run, handed in by the guild hall. With
    // nothing handed in (e.g. a direct boot), bounce back to the hall.
    if (!this.run || !this.loop) {
      this.scene.start("GuildScene");
      return;
    }

    this.titleText = this.add.text(this.scale.width / 2, 16, "", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.title }).setOrigin(0.5).setDepth(10);
    this.campText = this.add.text(this.scale.width / 2, 40, "", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0.5).setDepth(10);
    this.previewText = this.add.text(this.scale.width / 2, this.scale.height - 96, "", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body, align: "center", wordWrap: { width: 720 } }).setOrigin(0.5).setDepth(10);
    this.hintPanel = new HintPanel(this);

    this.refreshCampText();

    // Terminal screens take over the map.
    if (this.loop.isOver()) return this.runEnd();
    if (this.loop.isComplete()) return this.runComplete();

    // Returning from a resolved node (e.g. back from a combat BattleScene) lands on
    // the **Survey** beat (D46) — the now-informed post-event planning surface —
    // before the map. A fresh run sits at the un-played start node → straight to map.
    if (this.justResolvedCurrentNode()) return this.showSurvey();

    // The Expedition demo (M13) opens with a one-time orientation card.
    if (this.demoIntro) {
      this.demoIntro = false;
      this.drawMap();
      return this.showExpeditionIntro();
    }

    this.drawMap();
  }

  /** A one-time orientation card for the Expedition demo (M13). */
  private showExpeditionIntro(): void {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 10;
    const w = 680;
    const padX = 34;
    const intro = "An expedition is an economic routing problem: can you afford the route and a rest at its end?";
    const bullets = [
      "The map is fogged — deeper nodes hide until your intel reaches them.",
      "Pick a node to Make Camp, then End the Night to face it (fight · rest · event).",
      "After it resolves, Survey: read the forecast, rest in place, scout — then Break Camp.",
      "Open the Ledger anytime: cross a line off to skip it and free its gold.",
      "Tolls are known, loot is fogged — route to a rest node to fully recover.",
    ];
    const body = intro + "\n\n" + bullets.map((b) => `•  ${b}`).join("\n");
    const h = 264;
    const left = cx - w / 2 + padX;
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.96).setStrokeStyle(2, COLOR.success).setDepth(20),
      this.add.text(cx, cy - h / 2 + 24, "The Long Road Home — an Expedition", { color: INK.success, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(left, cy - h / 2 + 52, body, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label, align: "left", lineSpacing: 5, wordWrap: { width: w - 2 * padX } }).setOrigin(0, 0).setDepth(21),
    );
    this.overlay.push(
      this.makeTextButton(cx, cy + h / 2 - 20, 160, 30, "Continue", COLOR.successDeep, COLOR.success, () => {
        for (const o of this.overlay) o.destroy();
        this.overlay = [];
        this.setHint("Hover a node to preview it; click to Make Camp. Deeper nodes are fogged until intel reaches them.");
      }).setDepth(22),
    );
  }

  /** True if the current node has just been played (its event is in history) — Survey time (D46). */
  private justResolvedCurrentNode(): boolean {
    const last = this.run.history[this.run.history.length - 1];
    return !!last && last.nodeId === this.run.mapNodeId;
  }

  /** After a node's event resolves: a terminal screen, or the Survey beat (D46). */
  private afterNode(): void {
    if (this.loop.isOver()) return this.runEnd();
    if (this.loop.isComplete()) return this.runComplete();
    this.showSurvey();
  }

  // --- Map drawing ----------------------------------------------------------

  private drawMap(interactive = true): void {
    for (const o of this.nodeObjects) o.destroy();
    this.nodeObjects = [];
    this.graph?.destroy();
    this.nodePos.clear();

    const map = this.run.map;
    const reachableIds = new Set(this.loop.reachable().map((n) => n.id));
    const onPath = new Set(this.run.path);
    // Overworld fog (D48): only nodes within intel reach are drawn in full; the
    // rest are silhouettes. Immediate choices are always visible (never stuck).
    const visibleIds = new Set(visibleNodes(this.run).map((n) => n.id));

    this.titleText.setText(`Overworld — Night ${this.run.night + 1} · choose your next move`);

    // Layout: layers left→right, nodes spread vertically within each layer.
    const marginX = 80;
    const usableW = this.scale.width - 2 * marginX;
    const centerY = this.scale.height / 2 - 20;
    const byLayer = new Map<number, MapNode[]>();
    for (const id of map.order) {
      const node = map.nodes[id];
      byLayer.set(node.layer, [...(byLayer.get(node.layer) ?? []), node]);
    }
    for (const [layer, nodes] of byLayer) {
      const x = map.layers > 1 ? marginX + (layer * usableW) / (map.layers - 1) : this.scale.width / 2;
      const rowGap = 84;
      nodes.forEach((node, i) => {
        const y = centerY + (i - (nodes.length - 1) / 2) * rowGap;
        this.nodePos.set(node.id, { x, y });
      });
    }

    // Edges underneath the nodes — only between visible endpoints (fog, D48).
    this.graph = this.add.graphics().setDepth(0);
    for (const id of map.order) {
      const from = this.nodePos.get(id)!;
      for (const e of map.nodes[id].edges) {
        if (!visibleIds.has(id) || !visibleIds.has(e)) continue; // hide fogged edges
        const to = this.nodePos.get(e)!;
        const live = this.run.mapNodeId === id; // edges out of the current node
        this.graph.lineStyle(live ? 3 : 1.5, live ? COLOR.accent : COLOR.border, live ? 0.9 : 0.5);
        this.graph.lineBetween(from.x, from.y, to.x, to.y);
      }
    }

    // Nodes on top.
    for (const id of map.order) {
      const node = map.nodes[id];
      const pos = this.nodePos.get(id)!;
      const reachable = reachableIds.has(id);
      const current = this.run.mapNodeId === id;
      const visited = onPath.has(id) && !current;
      if (!visibleIds.has(id)) this.drawFogged(pos);
      else this.drawNode(node, pos, { reachable, current, visited }, interactive);
    }

    // A compact, always-on key in the corner — replaces the glyph dump that used to
    // crowd the hint bar (D58); the hint now carries action guidance only.
    this.drawMapLegend();
    this.setHint("Click a node to preview it; click again to Make Camp. Deeper nodes are fogged — raise intel to see farther.");
    this.previewText.setText("");
  }

  /**
   * A small, muted key pinned to the map's bottom-left (D58) — **generated from the
   * {@link ICON} registry** (D59), so it can never drift from the board, and rendered
   * in the UI font (the glyphs are verified safe there). Clears with the map.
   */
  private drawMapLegend(): void {
    const key = legendLine(["combat", "rest", "goal", "thief", "shop", "recruiter", "story", "toll", "fogged"]);
    const legend = this.add
      .text(20, this.scale.height - 30, key, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption })
      .setOrigin(0, 0.5)
      .setDepth(3);
    this.nodeObjects.push(legend);
  }

  /** Icon key + circle tint for an event node, keyed by which event it runs (M11). */
  private eventVisual(node: MapNode): { key: IconKey; color: number } {
    switch (eventForNode(this.run.seed, node).kind as EventKind) {
      case "shop": return { key: "shop", color: COLOR.gold };
      case "recruiter": return { key: "recruiter", color: COLOR.info };
      case "story": return { key: "story", color: COLOR.captive };
      case "toll": return { key: "toll", color: COLOR.gold };
      case "thief":
      default: return { key: "thief", color: COLOR.captive };
    }
  }

  /** A fogged node (D48): a dim silhouette with no contents — out of intel reach. */
  private drawFogged(pos: { x: number; y: number }): void {
    const circle = this.add.circle(pos.x, pos.y, 13, COLOR.tileDark, 0.5).setDepth(1);
    circle.setStrokeStyle(1, COLOR.border, 0.4);
    // ◌ (not "?", which now means a story event) — disambiguated via the registry.
    const label = placeIcon(this, pos.x, pos.y, "fogged", { color: INK.disabled }).setDepth(2);
    this.nodeObjects.push(circle, label);
  }

  private drawNode(node: MapNode, pos: { x: number; y: number }, state: { reachable: boolean; current: boolean; visited: boolean }, interactive = true): void {
    const isFinal = node.layer === this.run.map.layers - 1;
    const event = node.kind === "event" ? this.eventVisual(node) : undefined;
    const baseColor =
      node.kind === "rest" ? COLOR.success : event ? event.color : isFinal ? COLOR.gold : COLOR.danger;
    const radius = isFinal ? 20 : 15;

    let alpha = 0.32;
    if (state.current) alpha = 1;
    else if (state.reachable) alpha = 1;
    else if (state.visited) alpha = 0.6;

    const circle = this.add.circle(pos.x, pos.y, radius, baseColor, alpha).setDepth(1);
    if (state.current) circle.setStrokeStyle(3, COLOR.white, 1);
    else if (state.reachable) circle.setStrokeStyle(3, COLOR.accent, 1);
    else circle.setStrokeStyle(1, COLOR.tileDark, 0.8);
    this.nodeObjects.push(circle);

    // Kind glyph, from the registry (event nodes carry a per-event icon, M11). Routed
    // through placeIcon so a future atlas swaps in without touching this call (D59).
    const iconKey: IconKey = node.kind === "rest" ? "rest" : event ? event.key : isFinal ? "goal" : "combat";
    const label = placeIcon(this, pos.x, pos.y, iconKey, { color: INK.onLight, size: isFinal ? FONT.heading : FONT.body }).setDepth(2);
    this.nodeObjects.push(label);

    if (state.visited) {
      const tick = this.add.text(pos.x + radius - 2, pos.y - radius + 2, ICON.check.glyph, { color: INK.success, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5).setDepth(2);
      this.nodeObjects.push(tick);
    }

    if (state.reachable) {
      // Hover always previews; the commit click is gated so the read-only Route-map
      // review can show the same board without letting you re-choose a node (D58).
      circle.setInteractive({ useHandCursor: interactive });
      circle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.showPreview(node));
      if (interactive) circle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.enterCamp(node));
    }
  }

  // --- Selection / preview (D24) --------------------------------------------

  private showPreview(node: MapNode): void {
    // Read at the floor + whatever Scout has bought for this node (D35).
    const p = previewNode(this.run, node.id, scoutedTier(this.run.overworld, node.id));
    this.previewText.setText(this.describePreview(p));
  }

  private describePreview(p: NodePreview): string {
    if (p.kind === "rest") return `Layer ${p.layer} · Rest — ${p.restHint}`;
    if (p.kind === "event") return `Layer ${p.layer} · Event — ${p.eventHint}`;
    const parts = [`Layer ${p.layer} · Combat (${p.encounterType})`];
    if (p.intel?.types) parts.push(`enemies: ${p.intel.types.join(", ")}`);
    else parts.push("enemies: unknown");
    if (p.intel?.count !== undefined) parts.push(`count: ${p.intel.count}`);
    if (p.intel?.grantsVision) parts.push("starting vision");
    parts.push(`reward: ${p.rewardHint ?? "unknown"}`);
    return parts.join("   ·   ");
  }

  private clearMap(): void {
    for (const o of this.nodeObjects) o.destroy();
    this.nodeObjects = [];
    this.graph?.destroy();
    this.graph = undefined;
    this.previewText.setText("");
  }

  /**
   * A **read-only** peek at the route map from camp/Survey (D58) — those surfaces
   * hide the map, so this brings it back to look at: hover a node to preview it,
   * but no committing. `returnTo` rebuilds the surface you came from (camp/Survey).
   */
  private reviewMap(returnTo: () => void): void {
    this.clearCamp();
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    this.drawMap(false); // non-interactive: hover-preview only, no node commit
    this.titleText.setText(`Route Map — Night ${this.run.night + 1} · reviewing`);
    this.setHint("Reviewing the route — hover a node to preview it. Click Back to return.");
    // Below the centred HUD line so it doesn't sit on the readouts.
    const back = this.makeTextButton(90, 78, 150, 28, "← Back", COLOR.surfaceRaised, COLOR.border, () => {
      this.clearMap();
      returnTo();
    });
    this.nodeObjects.push(back);
  }

  // --- The unified overworld camp (D35) -------------------------------------

  /**
   * Open the unified camp at a chosen node: advance the run there, then surface the
   * overworld actions (cooldown- + fatigue-gated) and meta/provision actions before
   * the player commits onward. This is the single between-nodes surface (D35).
   */
  private enterCamp(node: MapNode): void {
    this.clearMap();
    this.loop.choose(node.id);
    this.campNode = node;
    this.campAdvanced = false; // every camp opens with the economy tucked away (D58)
    this.renderCamp();
  }

  /** (Re)draw the camp panel — called after every action so readouts stay live. */
  private renderCamp(): void {
    const node = this.campNode!;
    this.clearCamp();
    this.refreshCampText();

    const isCombat = node.kind === "combat";
    const kindLabel = isCombat
      ? `Combat (layer ${node.layer})`
      : node.kind === "event"
        ? `Event — ${this.loop.eventDef().name}`
        : "Rest";
    this.titleText.setText(`Make Camp — Night ${this.run.night + 1} · ${kindLabel}`);
    this.setHint("Make Camp: provision, heal, glance the ledger — then End the Night. The Banker/Noble economy lives under ‘Advanced’; safe to ignore early.");

    const cx = this.scale.width / 2;
    const panelW = 720;
    const top = 90;
    const colX = cx - panelW / 2 + 30;
    const rowH = 30;

    // --- Camp: the signature non-combat job actions + everyday provisioning ---
    this.campObjects.push(
      this.add.text(colX - 10, top - 6, "Camp", { color: INK.success, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
    );
    let y = top + 22;
    for (const u of this.run.party) {
      for (const skill of unitSkills(u, "meta")) {
        this.campButton(colX, y, 360, 24, `${u.name}: ${skill.name}`, true, () => this.useCampSkill(u, skill), `${skill.name} — ${skill.description}`);
        y += rowH;
      }
    }
    // One trap-kit buy (D58): Merchant-priced if one rides along, else the flat rate.
    const kitPrice = this.trapKitPrice(node);
    this.campButton(colX, y, 360, 24, `Buy Trap Kit (${kitPrice}g)`, true, () => this.buyTrapKit(), "Buy a Trap Kit into storage (1 slot) for the Scout/Survivalist. Cheaper at a town/rest node, or with a Merchant in the party.");
    y += rowH;
    this.campButton(colX, y, 360, 24, "Triage Heal", true, () => this.triage(), "Spend Rest Points to heal the most-wounded fighter one chunk (D9).");
    y += rowH + 8;

    // --- Advanced ▸ : the optional gold economy, collapsed by default (D58) ---
    this.campButton(colX, y, 360, 24, `${this.campAdvanced ? ICON.collapse.glyph : ICON.expand.glyph}  Advanced — Banker · Noble · Market`, true, () => { this.campAdvanced = !this.campAdvanced; this.renderCamp(); }, "Optional economy verbs: interest, borrowing, theft protection, influence, and the market. Safe to leave alone while you learn the loop.");
    y += rowH;
    if (this.campAdvanced) {
      const subX = colX + 16;
      const subW = 344;
      const market = getAbility("market")!;
      const marketActor = this.marketActor();
      const mRefusal = this.refusal(market, marketActor);
      this.campButton(subX, y, subW, 24, `Shop the market  ·  ${this.costReadout(market, marketActor)}`, !mRefusal, () => this.doOverworldAction(marketActor, "market"), mRefusal ?? "Merchant ACCESS (D30): open the market to buy supply into storage from the purse.");
      y += rowH;
      this.campButton(subX, y, subW, 24, "Invest the purse", true, () => this.bankerInterest(), "Banker (D30): the carried purse accrues flat interest each node-step. Purse only — never the treasury.");
      y += rowH;
      this.campButton(subX, y, subW, 24, "Borrow 40g", true, () => this.bankerBorrow40(), "Banker (D30): overspend now; auto-repaid from incoming run gold.");
      y += rowH;
      this.campButton(subX, y, subW, 24, `Guard the purse (${ECONOMY.banker.protectionCost}g)`, true, () => this.bankerProtect(), "Banker (D30): blunt a thief's skim — battle thief and event node alike.");
      y += rowH;
      this.campButton(subX, y, subW, 24, "Gather influence", !!this.guild, () => this.nobleIncome(), "Noble (D30/D34): earn Influence — a separate currency that can never pay Upkeep. Bribe enemies mid-battle.");
      y += rowH;
      // The Banker's purse-state, moved off the always-on HUD line into context (D58).
      const eco = this.run.overworld;
      const bank: string[] = [];
      if (eco.interestPerStep > 0) bank.push(`interest +${eco.interestPerStep}g/step`);
      if (eco.debt > 0) bank.push(`debt ${eco.debt}g`);
      if (eco.protection > 0) bank.push(`protection ${Math.round(eco.protection * 100)}%`);
      if (this.guild) bank.push(`Influence ${this.guild.influence}`);
      if (bank.length) {
        this.campObjects.push(this.add.text(subX, y, bank.join("   ·   "), { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(11));
        y += rowH;
      }
    }
    const leftBottom = y + 8;

    // --- Fatigue meter (per-character, banded — à la the morale readout) ---
    const meterX = cx + 60;
    this.campObjects.push(
      this.add.text(meterX, top - 6, "Fatigue", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
      this.add.text(meterX, top + 18, this.fatigueMeter(), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, lineSpacing: 6 }).setOrigin(0, 0).setDepth(11),
    );
    const meterBottom = top + 18 + this.run.party.filter((u) => u.alive).length * 21 + 8;

    // --- Right column: review the route + glance the ledger (D45/D58) ---
    const utilY = Math.max(leftBottom + 8, meterBottom);
    this.campButton(cx + 60, utilY, 240, 24, "Review Route Map", true, () => this.reviewMap(() => this.renderCamp()), "Look at the overworld node map (read-only) — your route, what's reachable, and what's still fogged. Click Back to return to camp.");
    this.campButton(cx + 60, utilY + 30, 240, 24, "Open Ledger (totals + forecast)", true, () => this.showLedgerPanel(() => this.renderCamp()), "The economic ledger (D45): purse-scoped totals you can expand to line items, plus the route forecast (D48).");

    // --- End the Night — the prep→event gate (D46); placed below all content ---
    const contentBottom = Math.max(leftBottom + 8, utilY + 30);
    // For combat the night doesn't *end* — it erupts — so the wording stays "Begin
    // Mission" (D45 fork 2); rest/event "End the Night" into their payload.
    const commitLabel = isCombat
      ? "End the Night — Begin Mission"
      : node.kind === "event"
        ? "End the Night — Approach the Event"
        : "End the Night — Rest";
    const commit = this.makeTextButton(cx, contentBottom + 26, 260, 34, commitLabel, COLOR.successDeep, COLOR.success, () => this.commit());
    this.campObjects.push(commit);

    // Backdrop sized to the actual content (added last; its low depth keeps it behind).
    const panelTop = top - 22;
    const panelBottom = contentBottom + 50;
    this.campObjects.push(
      this.add.rectangle(cx, (panelTop + panelBottom) / 2, panelW, panelBottom - panelTop, COLOR.surface, 0.96).setStrokeStyle(2, COLOR.border).setDepth(8),
    );
  }

  /** A human-readable cost line for an overworld ability (cooldown + fatigue + gold). */
  private costReadout(ability: OverworldAbility, actor: Unit): string {
    const cd = cooldownRemaining(this.run.overworld, ability.id);
    const cdStr = cd > 0 ? `${cd} node${cd === 1 ? "" : "s"}` : "ready";
    const parts = [`cd: ${cdStr}`];
    const baseFat = ability.cost.fatigue ?? 0;
    if (baseFat > 0) {
      const surcharge = fatiguePenalty(actor.fatigue).surcharge;
      parts.push(`fatigue: ${baseFat + surcharge}${surcharge > 0 ? " (tired)" : ""}`);
    }
    if (ability.cost.gold) parts.push(`gold: ${ability.cost.gold}`);
    return parts.join(", ");
  }

  /** Why an ability would refuse right now (cooldown / exhaustion / gold), or null. */
  private refusal(ability: OverworldAbility, actor: Unit): string | null {
    const cd = cooldownRemaining(this.run.overworld, ability.id);
    if (cd > 0) return `On cooldown — ${cd} more node${cd === 1 ? "" : "s"}.`;
    const baseFat = ability.cost.fatigue ?? 0;
    if (baseFat >= fatiguePenalty(actor.fatigue).lockAtOrAbove) return `${actor.name} is too exhausted — rest first.`;
    if (ability.cost.gold && this.run.camp.gold < ability.cost.gold) return `Not enough gold (${ability.cost.gold}g).`;
    return null;
  }

  /** Units that can act on the overworld — alive and not bound (D7). */
  private activeUnits(): Unit[] {
    return this.run.party.filter((u) => u.alive && !u.captured);
  }

  /** The acting unit for Scout: the highest-Intelligence active member (a survey skill). */
  private scoutActor(): Unit {
    const active = this.activeUnits();
    return active.reduce((best, u) => (u.intelligence > best.intelligence ? u : best), active[0] ?? this.run.party[0]);
  }

  /** The acting unit for Market: the Merchant if active, else any active member. */
  private marketActor(): Unit {
    const active = this.activeUnits();
    return active.find((u) => u.jobId === "merchant") ?? active[0] ?? this.run.party[0];
  }

  /** A banded per-character fatigue readout (overworld-only, never combat). */
  private fatigueMeter(): string {
    return this.run.party
      .filter((u) => u.alive)
      .map((u) => `${u.name}: ${fatigueTier(u.fatigue)} (${u.fatigue})`)
      .join("\n");
  }

  private doOverworldAction(actor: Unit, abilityId: string, opts: { targetNodeId?: string } = {}): void {
    const res: ActionResult = this.loop.overworldAction(actor, abilityId, opts);
    this.renderCamp();
    this.setHint(res.applied ? `${res.detail ?? "Done."}` : `Can't: ${res.reason ?? "refused."}`);
  }

  private useCampSkill(actor: Unit, skill: SkillDef): void {
    // The signature action levels its owner now (D32/D53): a Chef grows from cooking.
    const out = useCampJobSkill(actor, skill, this.run.camp);
    if (out.storage) this.run.inventory.storageCap = this.run.camp.storageCap;
    this.renderCamp();
    const parts: string[] = [];
    if (out.gold) parts.push(`+${out.gold} gold`);
    if (out.storage) parts.push(`+${out.storage} storage`);
    if (out.morale) parts.push(`+${out.morale} morale`);
    if (out.bankedHeal) parts.push(`banked +${out.bankedHeal} HP/unit`);
    if (out.levels > 0) parts.push(`${actor.name} reached L${actor.level}!`);
    this.setHint(`${skill.name}: ${parts.join(", ")}.`);
  }

  /** Whether a Merchant rides along — they price (and route) the trap-kit buy. */
  private hasMerchant(): boolean {
    return this.run.party.some((u) => u.alive && u.jobId === "merchant");
  }

  /** The trap-kit price shown on the single Buy button (D58): Merchant tier, else flat. */
  private trapKitPrice(node: MapNode): number {
    if (this.hasMerchant()) return node.kind === "rest" ? ECONOMY.merchant.townPrice : ECONOMY.merchant.wildPrice;
    return 15;
  }

  /** The one trap-kit buy (D58): the Merchant ACCESS price/route if present, else flat. */
  private buyTrapKit(): void {
    if (this.hasMerchant()) this.merchantBuyKit();
    else this.provisionTrapKit();
  }

  private provisionTrapKit(): void {
    const cost = 15;
    if (this.run.camp.gold < cost) return this.setHint("Not enough gold for a Trap Kit (15g).");
    if (addItem(this.run.inventory, "trap-kit", 1)) {
      this.run.camp.gold -= cost;
      this.renderCamp();
      this.setHint(`Bought a Trap Kit (${countOf(this.run.inventory, "trap-kit")} carried).`);
    } else {
      this.setHint("Storage full — Market or Trade for more slots.");
    }
  }

  private triage(): void {
    const policy = runDifficulty(this.run);
    const wounded = combatRoster(this.run)
      .filter((u) => u.hp < u.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!wounded) return this.setHint("No wounded fighters to heal.");
    if (this.run.rp < policy.rpPerChunk) return this.setHint(`Not enough RP (need ${policy.rpPerChunk} for a ${chunkHp(wounded)} HP chunk).`);
    const res = triageHeal(wounded, policy.rpPerChunk, policy);
    this.run.rp -= res.rpSpent;
    this.renderCamp();
    this.setHint(`Triaged ${wounded.name}: +${res.hpHealed} HP for ${res.rpSpent} RP.`);
  }

  // --- The gold economy verbs (M10, D30/D34) --------------------------------

  private merchantBuyKit(): void {
    const node = this.campNode!;
    const res = merchantBuy(this.run, "trap-kit", node.kind);
    this.renderCamp();
    this.setHint(res.applied ? `${res.detail}` : `Can't: ${res.reason}`);
  }

  private bankerInterest(): void {
    const perStep = bankerEngageInterest(this.run);
    this.renderCamp();
    this.setHint(perStep > 0 ? `Banker: purse interest engaged — +${perStep}g per node-step (purse only).` : "No purse to earn interest on.");
  }

  private bankerBorrow40(): void {
    const res = bankerBorrow(this.run, 40);
    this.renderCamp();
    this.setHint(res.applied ? `Borrowed 40g (debt ${res.debt}g) — auto-repaid from incoming loot.` : `Can't: ${res.reason}`);
  }

  private bankerProtect(): void {
    const res = bankerProtect(this.run);
    this.renderCamp();
    this.setHint(res.applied ? `Theft protection engaged (skims blunted ${Math.round((res.protection ?? 0) * 100)}%).` : `Can't: ${res.reason}`);
  }

  private nobleIncome(): void {
    if (!this.guild) return this.setHint("No guild to bank Influence.");
    const gained = collectPoliticalIncome(this.guild);
    this.renderCamp();
    this.setHint(`Noble: +${gained} Influence (guild total ${this.guild.influence}). Influence can never pay Upkeep.`);
  }

  /** A camp button that greys out (non-interactive) when disabled, with a reason on hover. */
  private campButton(x: number, y: number, w: number, h: number, text: string, enabled: boolean, onClick: () => void, description: string): void {
    const fill = enabled ? COLOR.surfaceAlt : COLOR.surfaceRaised;
    const bg = this.add.rectangle(x, y, w, h, fill).setStrokeStyle(1, enabled ? COLOR.borderSoft : COLOR.surfaceAlt).setOrigin(0, 0.5).setDepth(10);
    const label = this.add.text(x + 8, y, text, { color: enabled ? INK.bright : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(11);
    fitText(label, w - 16);
    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
    }
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.hintPanel.setText(description));
    this.campObjects.push(bg, label);
  }

  private clearCamp(): void {
    for (const o of this.campObjects) o.destroy();
    this.campObjects = [];
  }

  /** Leave the camp and play the node (D35): combat hands off; rest recovers here. */
  private commit(): void {
    const node = this.campNode!;
    this.clearCamp();
    this.campNode = undefined;
    if (node.kind === "combat") {
      // Hand the run off to the battle flow; it returns to this scene when done.
      this.scene.start("BattleScene", { run: this.run, loop: this.loop, guild: this.guild, caravanId: this.caravanId } as RunHandoff);
    } else if (node.kind === "event") {
      this.playEvent();
    } else {
      this.playRest();
    }
  }

  // --- Event nodes (the data-driven registry, M11, D4/D23) ------------------

  /** Open the event screen for the current node, dispatched by its event kind. */
  private playEvent(): void {
    const kind = this.loop.eventDef().kind;
    switch (kind) {
      case "shop": return this.showShopScreen();
      case "recruiter": return this.showRecruiterScreen();
      case "story": return this.showStoryScreen();
      case "thief":
      default: return this.playThiefEvent();
    }
  }

  /** Leave the event, record the node-step, and route to the Survey beat/terminal (D46). */
  private finishEvent(netGold: number): void {
    this.loop.recordEventNight(netGold);
    this.refreshCampText();
    this.afterNode();
  }

  // Thief — no choice; resolve the skim (auto path) and report it (D30).
  private playThiefEvent(): void {
    const res = this.loop.eventNode(); // auto-resolves the skim + records the night
    this.refreshCampText();
    const stolen = res.outcome.stolen ?? 0;
    const lines: string[] = [];
    if (stolen > 0) {
      lines.push(`A thief skimmed ${stolen}g off the purse on the road.`);
      const eco = this.run.overworld;
      if (eco.protection > 0) lines.push(`The Banker's protection blunted the loss (${Math.round(eco.protection * 100)}%).`);
      else lines.push("Buy the Banker's theft protection to blunt the next one.");
    } else {
      lines.push("The road was clear — the purse is intact.");
    }
    lines.push(`Purse now ${this.run.camp.gold}g.`);
    this.showOverlay(res.def.name, lines.join("\n"), stolen === 0, 520, 200, () => this.afterNode());
  }

  // Shop — buy supplies into storage from the purse (Merchant verb reused, D30/D34).
  private spentAtShop = 0;
  private showShopScreen(): void {
    this.spentAtShop = 0;
    this.renderEventChoicePanel("Roadside Market", "Spend purse gold on supplies into caravan storage — never the treasury.");
  }

  // Recruiter — hire a rolled body for the purse, joining the run party (D33).
  private showRecruiterScreen(): void {
    this.renderEventChoicePanel("Wandering Sellsword", "Hire a body for purse gold — it joins the caravan for the run.");
  }

  // Story — an authored choice; each option a deterministic outcome (D23).
  private showStoryScreen(): void {
    const node = this.campNode!;
    const story = storyForNode(this.run.seed, node);
    this.renderEventChoicePanel(this.loop.eventDef().name, story.prompt);
  }

  /**
   * The shared event-choice panel (M11): the event's choices as buttons. Shop buys
   * leave the panel open (buy several, then Leave); a recruiter/story pick is
   * terminal (it resolves and continues). Re-rendered after each shop buy so the
   * readouts (purse, availability) stay live.
   */
  private renderEventChoicePanel(title: string, body: string): void {
    const def = this.loop.eventDef();
    const choices = this.loop.eventChoices();
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 20;
    const w = 560;
    const h = 130 + (choices.length + (def.kind === "shop" ? 1 : 0)) * 40;

    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.96).setStrokeStyle(2, COLOR.info).setDepth(20),
      this.add.text(cx, cy - h / 2 + 24, title, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(cx, cy - h / 2 + 58, `${body}\nPurse ${this.run.camp.gold}g`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body, align: "center", lineSpacing: 4, wordWrap: { width: w - 60 } }).setOrigin(0.5).setDepth(21),
    );

    let y = cy - h / 2 + 110;
    for (const choice of choices) {
      const enabled = choice.available;
      const fill = enabled ? COLOR.btnFill : COLOR.surfaceRaised;
      const stroke = enabled ? COLOR.info : COLOR.border;
      const btn = this.makeTextButton(cx, y, 360, 30, choice.label, fill, stroke, () => {
        if (!enabled) return;
        this.onEventChoice(choice);
      });
      if (choice.detail) btn.bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.setHint(choice.detail!));
      this.overlay.push(btn);
      y += 40;
    }

    // A shop is a multi-buy surface — add an explicit Leave that records the step.
    if (def.kind === "shop") {
      const leave = this.makeTextButton(cx, y, 360, 30, "Leave the market", COLOR.successDeep, COLOR.success, () => {
        for (const o of this.overlay) o.destroy();
        this.overlay = [];
        this.finishEvent(-this.spentAtShop);
      });
      this.overlay.push(leave.bg, leave.label);
    }
  }

  /** Apply a chosen event option, then re-render (shop) or continue (terminal). */
  private onEventChoice(choice: EventChoice): void {
    const def = this.loop.eventDef();
    const out: EventOutcome = this.loop.chooseEvent(choice.id);
    this.refreshCampText();

    if (def.kind === "shop" && choice.id.startsWith("buy:")) {
      // Stay in the market: track spend, report, re-render for the next buy.
      this.spentAtShop += -out.goldDelta;
      this.setHint(out.summary);
      this.renderEventChoicePanel("Roadside Market", "Spend purse gold on supplies into caravan storage — never the treasury.");
      return;
    }

    // Recruiter / story: a terminal pick — record the step and report the outcome.
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    const lines = [out.summary, "", `Purse now ${this.run.camp.gold}g.`];
    if (out.recruited) lines.push(`${out.recruited.name} now rides with the caravan.`);
    this.loop.recordEventNight(out.goldDelta);
    this.refreshCampText();
    const good = out.goldDelta >= 0 && out.moraleDelta >= 0;
    this.showOverlay(def.name, lines.join("\n"), good, 520, 200, () => this.afterNode());
  }

  // --- Rest node (D23) -------------------------------------------------------

  private playRest(): void {
    const res = this.loop.restNode();
    this.refreshCampText();
    this.showRestScreen(res);
  }

  private showRestScreen(res: RestResult): void {
    const lines: string[] = [];
    const upkeepNote = res.upkeep.underfunded.length > 0 ? `Underfunded ${res.upkeep.underfunded.join(" + ")} — morale took a hit.` : `Upkeep paid (${res.upkeep.paid}g).`;
    lines.push(upkeepNote);
    lines.push(`Banked +${res.rpAdded} Rest Points; morale +${res.moraleGained}.`);
    if (res.healed.length) lines.push(`Triaged: ${res.healed.map((h) => `${h.unitId} +${h.hp} HP`).join(", ")}.`);
    else lines.push("No one needed triage — the party rested easy.");
    if (res.fatigueRestored.length) lines.push(`Fatigue restored: ${res.fatigueRestored.join(", ")} back to Rested.`);
    else lines.push("Everyone was already rested.");
    // The premium tier clears accumulated worn-gear debt in one swipe (D47).
    if (res.debtCleared > 0) lines.push(`Cleared ${res.debtCleared} worn-gear debt — gear refit.`);
    if (res.dyingLost.length) lines.push(`Lost to wounds: ${res.dyingLost.join(", ")}.`);

    this.showOverlay("Rest", lines.join("\n"), true, 520, 220, () => this.afterNode());
  }

  // --- The Survey beat (post-event planning, D46) ----------------------------

  /**
   * The **Survey** beat (D46) — the now-informed, post-event planning surface: read
   * the route {@link "../../core".projectForecast | forecast} (D48), take a costed
   * **in-place rest** (D47, repeatable), scout ahead, glance the ledger — then
   * **Break Camp** (the soft gate) back to the map. Deliberately light & optional.
   */
  private showSurvey(): void {
    this.clearMap();
    this.clearCamp();
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    this.campNode = currentNode(this.run);
    this.refreshCampText();

    this.titleText.setText(`Survey — Night ${this.run.night} · plan your route`);
    this.setHint("Survey (D46): read the forecast, rest in place (a night's rations, repeatable), scout ahead — then Break Camp to the map.");

    const cx = this.scale.width / 2;
    const panelW = 760;
    const top = 92;
    const colX = cx - panelW / 2 + 30;
    const rowH = 30;

    const forecast = projectForecast(this.run);
    this.campObjects.push(
      this.add.text(colX - 10, top - 6, "Route forecast (D48)", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
      this.add.text(colX - 10, top + 18, this.forecastSummary(forecast), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 5, wordWrap: { width: panelW - 60 } }).setOrigin(0, 0).setDepth(11),
    );
    let y = top + 26 + (forecast.perEdge.length + 1) * 18 + 14;

    // In-place rest (D47): a repeatable, costed heal — greys at full / when broke.
    const rest = this.inPlaceRestReadout();
    this.campButton(colX, y, 360, 24, `Rest in place — ${rest.label}`, rest.enabled, () => this.doInPlaceRest(), rest.detail);
    y += rowH;

    // Scout a reachable node — raises its intel, tightening the forecast (D48).
    const scout = getAbility("scout")!;
    for (const target of this.loop.reachable()) {
      const actor = this.scoutActor();
      const refusal = this.refusal(scout, actor);
      this.campButton(colX, y, 360, 24, `Scout → ${target.id} (${this.costReadout(scout, actor)})`, !refusal, () => { this.loop.overworldAction(actor, "scout", { targetNodeId: target.id }); this.showSurvey(); }, refusal ?? scout.description);
      y += rowH;
    }

    this.campButton(colX, y, 360, 24, "Review Route Map", true, () => this.reviewMap(() => this.showSurvey()), "Look at the overworld node map (read-only) — route, reachable nodes, and fog. Click Back to return to Survey.");
    y += rowH;
    this.campButton(colX, y, 360, 24, "Open Ledger (totals + forecast)", true, () => this.showLedgerPanel(() => this.showSurvey()), "The economic ledger (D45): purse-scoped totals, expandable to lines, plus the forecast.");
    y += rowH + 6;

    const breakBtn = this.makeTextButton(cx, y + 12, 240, 34, "Break Camp →", COLOR.successDeep, COLOR.success, () => this.breakCampToMap());
    this.campObjects.push(breakBtn);

    const panelTop = top - 22;
    const panelBottom = y + 40;
    this.campObjects.push(
      this.add.rectangle(cx, (panelTop + panelBottom) / 2, panelW, panelBottom - panelTop, COLOR.surface, 0.96).setStrokeStyle(2, COLOR.border).setDepth(8),
    );
  }

  /** A compact text readout of the route forecast (D48) — burn, runway, per-edge. */
  private forecastSummary(f: RouteForecast): string {
    const r = f.runway;
    const lines: string[] = [];
    const rest = r.nearestRestSteps === undefined ? "fogged (raise intel)" : `${r.nearestRestSteps} step(s), purse ~${r.purseAtRest}g there`;
    lines.push(`Burn ${r.burnPerStep}g/step   ·   nearest rest: ${rest}`);
    for (const e of f.perEdge) {
      const loot = e.lootBand.label ?? (e.lootBand.floor > 0 ? `≥${e.lootBand.floor}g` : "unknown");
      const ceil = e.purseAfter.ceiling === undefined ? "…" : `${e.purseAfter.ceiling}g`;
      lines.push(`${e.warn ? "⚠ " : "  "}${e.nodeId} (${e.kind}): cost ${e.costKnown}g · loot ${loot} → purse ${e.purseAfter.floor}…${ceil}`);
    }
    return lines.join("\n");
  }

  /** The in-place-rest button's label/availability (cost/heal, greys at full/broke). */
  private inPlaceRestReadout(): { label: string; detail: string; enabled: boolean } {
    const bill = computeUpkeep(this.run.party);
    const wounded = combatRoster(this.run).some((u) => u.hp < u.maxHp);
    const affordable = this.run.camp.gold >= bill.total;
    const enabled = wounded && affordable;
    const label = !wounded ? "party at full HP" : !affordable ? `need ${bill.total}g (broke)` : `pay ${bill.total}g · heal a little (+RP)`;
    return {
      label,
      detail: "In-place rest (D47): pay a night's rations to bank RP + a small heal (floors at ≥1). Repeatable; each rest is a node-step (ticks cooldowns). Greys at full HP / when broke.",
      enabled,
    };
  }

  private doInPlaceRest(): void {
    const res: InPlaceRestResult = this.loop.inPlaceRest();
    this.refreshCampText();
    if (res.applied) this.setHint(`Rested in place: −${res.goldSpent}g rations, +${res.hpHealed} HP, +${res.rpAdded} RP. Cooldowns ticked (a node-step passed).`);
    else this.setHint(`Can't rest: ${res.reason}`);
    if (this.loop.isOver()) return this.runEnd();
    this.showSurvey();
  }

  /** Break Camp → the soft, intent-aware gate (D45) → the map. */
  private breakCampToMap(): void {
    const gate = nightEndGate(this.run);
    if (!gate.warn) return this.toMap();
    // Hard-stop with a forced look only when warranted; never a per-night chore.
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 10;
    const w = 560;
    const h = 150 + gate.reasons.length * 18;
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.97).setStrokeStyle(2, COLOR.danger).setDepth(24),
      this.add.text(cx, cy - h / 2 + 24, "Before you break camp…", { color: INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(25),
      this.add.text(cx, cy - h / 2 + 56, gate.reasons.map((r) => `• ${r}`).join("\n"), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, align: "left", lineSpacing: 5, wordWrap: { width: w - 60 } }).setOrigin(0.5, 0).setDepth(25),
    );
    const stay = this.makeTextButton(cx - 110, cy + h / 2 - 22, 180, 30, "Stay in camp", COLOR.surfaceRaised, COLOR.border, () => this.showSurvey()).setDepth(26);
    const go = this.makeTextButton(cx + 110, cy + h / 2 - 22, 180, 30, "Break Camp anyway", COLOR.danger, COLOR.danger, () => this.toMap()).setDepth(26);
    this.overlay.push(stay, go);
  }

  /** Leave the Survey for the map (the gate already cleared). */
  private toMap(): void {
    this.clearCamp();
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    this.campNode = undefined;
    this.drawMap();
  }

  // --- The economic ledger panel (D45) ---------------------------------------

  /**
   * The ledger panel (D45), styled as **ledger paper**: ruled rows, descriptions
   * left, a right-hand **amount column**, the embedded forecast, Influence shown but
   * walled off (D34), and a **jump-to-market** when usable. The **Upkeep** rows are
   * **clickable** — click one to *cross it off the ledger* (a voluntary skip, D45):
   * the line strikes through, its amount disappears (the gold is freed), and the
   * intent-aware gate won't nag it. Click again to restore it. Every number flows
   * through {@link buildLedger}.
   */
  private showLedgerPanel(onClose: () => void): void {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    const node = this.campNode ?? currentNode(this.run);
    const merchantReady = node.kind === "rest" && this.run.party.some((u) => u.alive && u.jobId === "merchant") && cooldownRemaining(this.run.overworld, "market") === 0;
    const ledger: Ledger = buildLedger(this.run, { influence: this.guild?.influence ?? 0, marketReady: merchantReady });

    const cx = this.scale.width / 2;
    const w = 620;
    const pad = 30;
    const leftX = cx - w / 2 + pad;
    const rightX = cx + w / 2 - pad;
    const colX = rightX - 86; // the amount-column rule (a classic ledger column)
    const rowH = 22;

    // Size the sheet to its content (header + rows + forecast + buttons).
    const rowsCount = ledger.categories.reduce((n, c) => n + 1 + c.lines.length, 0);
    const forecastLines = this.forecastSummary(ledger.forecast).split("\n");
    const headH = 64;
    const forecastH = 18 + forecastLines.length * 14 + 12;
    const btnH = 46;
    const h = Math.min(this.scale.height - 16, headH + rowsCount * rowH + forecastH + btnH + 20);
    const cy = this.scale.height / 2;
    const top = cy - h / 2;

    // Depths: sheet 23 · ruling/hit 24 · text 25 · buttons 26.
    const g = this.add.graphics().setDepth(24);
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.surface, 0.98).setStrokeStyle(2, COLOR.gold).setDepth(23),
      g,
      this.add.text(cx, top + 16, "Ledger", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(25),
      this.add.text(leftX, top + 40, `Balance  ${ledger.balance}g`, { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
      this.add.text(rightX, top + 40, `Influence ${ledger.influence} · never pays Upkeep`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
    );
    // Double rule under the header (ledger feel).
    g.lineStyle(1, COLOR.borderSoft, 0.9);
    g.lineBetween(leftX, top + 54, rightX, top + 54);
    g.lineBetween(leftX, top + 56, rightX, top + 56);

    let y = top + 56 + 18;
    const rowsTop = y - rowH / 2;
    for (const cat of ledger.categories) {
      // Category header row (label + running total, both in gold).
      const tag = cat.projected ? "  (projected)" : "";
      this.overlay.push(
        this.add.text(leftX, y, `${cat.label}${tag}`, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
        this.add.text(rightX, y, this.signed(cat.total), { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(1, 0.5).setDepth(25),
      );
      g.lineStyle(1, COLOR.border, 0.5);
      g.lineBetween(leftX, y + rowH / 2, rightX, y + rowH / 2);
      y += rowH;

      for (const l of cat.lines) {
        const skipped = l.note === "voluntarily skipped";
        const interactive = cat.id === "upkeep"; // only Upkeep lines are skippable
        const labelInk = skipped ? INK.disabled : interactive ? INK.bright : INK.secondary;
        this.overlay.push(
          this.add.text(leftX + 18, y, l.label, { color: labelInk, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
        );
        // The amount on the right — gone when the line is crossed off (D45).
        this.overlay.push(
          skipped
            ? this.add.text(rightX, y, "— skipped —", { color: INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25)
            : this.add.text(rightX, y, this.signed(l.amount), { color: l.amount < 0 ? INK.danger : INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
        );
        // Strike the row through when crossed off.
        if (skipped) {
          g.lineStyle(1.5, COLOR.danger, 0.85);
          g.lineBetween(leftX + 12, y, rightX, y);
        }
        // Faint per-entry rule (ledger paper).
        g.lineStyle(1, COLOR.border, 0.28);
        g.lineBetween(leftX + 12, y + rowH / 2, rightX, y + rowH / 2);

        // Upkeep rows are clickable: cross off (skip) / restore. The hit rect sits
        // below the text (depth 24) so its hover wash reads behind the ink.
        if (interactive) {
          const lineId = l.id.replace("upkeep:", "") as UpkeepLine["id"];
          const hit = this.add.rectangle(cx, y, w - 2 * pad + 12, rowH, COLOR.surfaceAlt, 0).setDepth(24).setInteractive({ useHandCursor: true });
          hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
            hit.setFillStyle(COLOR.surfaceAlt, 0.35);
            this.setHint(skipped ? `Click to restore ${l.label} to the ledger (fund it again).` : `Click to cross ${l.label} off the ledger — frees its gold; you'll take the consequence and the gate won't nag.`);
          });
          hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => hit.setFillStyle(COLOR.surfaceAlt, 0));
          hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.toggleSkip(lineId, onClose));
          this.overlay.push(hit);
        }
        y += rowH;
      }
    }

    // The vertical amount-column rule down the rows region.
    g.lineStyle(1, COLOR.borderSoft, 0.45);
    g.lineBetween(colX, rowsTop, colX, y - rowH / 2);

    // Forecast footer.
    y += 8;
    this.overlay.push(
      this.add.text(leftX, y, "Forecast (D48)", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
    );
    y += 16;
    this.overlay.push(
      this.add.text(leftX, y, forecastLines.join("\n"), { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 3, wordWrap: { width: rightX - leftX } }).setOrigin(0, 0).setDepth(25),
    );

    // Buttons (depth 26 — above the sheet).
    const by = top + h - 22;
    if (ledger.marketReady) {
      this.overlay.push(this.makeTextButton(leftX + 90, by, 170, 28, "Jump to Market", COLOR.btnFill, COLOR.gold, () => { this.merchantBuyKit(); this.showLedgerPanel(onClose); }).setDepth(26));
    }
    this.overlay.push(this.makeTextButton(rightX - 60, by, 110, 28, "Close", COLOR.surfaceRaised, COLOR.border, () => { for (const o of this.overlay) o.destroy(); this.overlay = []; onClose(); }).setDepth(26));
  }

  /** A signed gold figure for the ledger (`+5g` / `-5g`). */
  private signed(n: number): string {
    return `${n >= 0 ? "+" : ""}${n}g`;
  }

  /** Toggle a voluntary Upkeep skip (D45) — crosses the line off / restores it. */
  private toggleSkip(id: UpkeepLine["id"], onClose: () => void): void {
    const set = new Set(this.run.camp.skippedUpkeep);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.run.camp.skippedUpkeep = [...set] as ("food" | "repairs")[];
    this.refreshCampText();
    this.setHint(set.has(id) ? `Crossed ${id} off the ledger — its gold is freed (you'll take the consequence; the gate won't nag).` : `${id} funded again.`);
    this.showLedgerPanel(onClose);
  }

  // --- Terminal screens ------------------------------------------------------

  private runComplete(): void {
    const won = this.run.history.filter((h) => h.winner === "player").length;
    const toHall = !!this.guild;
    const lines = [
      "The caravan cleared its final mission — the quest is complete!",
      "",
      `Survived ${this.run.night} night(s), won ${won} encounter(s).`,
      `Surviving purse ${this.run.camp.gold}g (flows back to the treasury).`,
      "",
      toHall ? "Return to the guild hall — survivors, gear and purse come home." : `Seed:  ${this.run.seed}`,
    ];
    this.titleText.setText("Quest Complete");
    this.showOverlay("Quest Complete!", lines.join("\n"), true, 560, 250, toHall ? () => this.returnToHall() : undefined);
    this.setHint(toHall ? "Quest complete. Return to the hall to bank the survivors, gear and purse." : "Run complete.");
  }

  private runEnd(): void {
    const won = this.run.history.filter((h) => h.winner === "player").length;
    const last = this.run.history[this.run.history.length - 1];
    const toHall = !!this.guild;
    // Graded terminal (D51): a final objective-failure is the caravan **returning
    // alive without the prize** — distinct from a wipe (the party is intact).
    const returnedAlive = last?.result === "objective-failure";
    if (returnedAlive) {
      const lines = [
        "The objective was lost — the caravan turns for home, alive but empty-handed.",
        "",
        `Survived ${this.run.night} night(s), won ${won} encounter(s).`,
        "",
        toHall ? "Return to the guild hall — the people and gear come home; the prize does not." : `Seed:  ${this.run.seed}`,
      ];
      this.titleText.setText("Returned Without the Prize");
      this.showOverlay("Returned Without the Prize", lines.join("\n"), false, 560, 250, toHall ? () => this.returnToHall() : undefined);
      this.setHint(toHall ? "Objective failed — return to the hall; the caravan survives, the prize is forfeit." : "Objective failed — the caravan returns alive.");
      return;
    }
    const lines = [
      last && last.winner === "enemy" ? "The caravan was overwhelmed." : "The caravan is lost.",
      "",
      `Survived ${this.run.night} night(s), won ${won} encounter(s).`,
      "",
      toHall ? "Return to the guild hall — the caravan's people and gear are lost, but the guild survives." : `Seed:  ${this.run.seed}`,
    ];
    this.titleText.setText("Caravan Wiped");
    this.showOverlay("Caravan Wiped", lines.join("\n"), false, 560, 250, toHall ? () => this.returnToHall() : undefined);
    this.setHint(toHall ? "Caravan wiped. Return to the hall — the guild survives; rebuild with a mercenary." : "Run over.");
  }

  /** Hand the run's terminal back to the guild hall, which resolves it (D27). */
  private returnToHall(): void {
    this.scene.start("GuildScene", { guild: this.guild, resolveCaravanId: this.caravanId });
  }

  // --- UI helpers ------------------------------------------------------------

  private refreshCampText(): void {
    const tier = moraleTier(this.run.camp.morale);
    // The always-on line is the four decision-relevant groups only (D58): Purse,
    // Morale, Storage/Kits, RP/Upkeep. The Banker's purse-state + Influence moved
    // into the camp's Advanced panel / ledger, where they're actionable.
    const upkeep = computeUpkeep(this.run.party).total;
    this.campText.setText(
      `Purse ${this.run.camp.gold}g  ·  Morale ${tier} (${this.run.camp.morale})  ·  ` +
        `Storage ${slotsUsed(this.run.inventory)}/${this.run.inventory.storageCap} (Kits ${countOf(this.run.inventory, "trap-kit")})  ·  ` +
        `RP ${this.run.rp}  ·  Upkeep ${upkeep}g/night`,
    );
  }

  private setHint(text: string): void {
    this.hintPanel.setResting(text);
  }

  private showOverlay(title: string, body: string, good: boolean, w = 480, h = 200, onContinue?: () => void): void {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 20;
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.94).setStrokeStyle(2, good ? COLOR.success : COLOR.danger).setDepth(20),
      this.add.text(cx, cy - h / 2 + 26, title, { color: good ? INK.success : INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(cx, cy + 6, body, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, align: "center", lineSpacing: 4, wordWrap: { width: w - 48 } }).setOrigin(0.5).setDepth(21),
    );
    if (onContinue) {
      const btn = this.makeTextButton(cx, cy + h / 2 - 20, 160, 30, "Continue", COLOR.successDeep, COLOR.success, () => {
        for (const o of this.overlay) o.destroy();
        this.overlay = [];
        onContinue();
      });
      this.overlay.push(btn);
    }
  }

  private makeTextButton(x: number, y: number, w: number, h: number, text: string, fill: number, stroke: number, onClick: () => void): Button {
    const btn = new Button(this, x, y, { text, w, h, fill, stroke, onClick });
    this.add.existing(btn).setDepth(22);
    return btn;
  }
}
