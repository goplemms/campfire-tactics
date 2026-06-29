import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import { PartyDossierView } from "../party-dossier-view";

/** The Captain's Tent tabs (D58) — the run's deep-info hub, one verb to open. */
type TentTab = "party" | "stores" | "ledger" | "map";
import {
  RunLoop,
  previewNode,
  countOf,
  canAdd,
  removeItem,
  slotsFor,
  slotsUsed,
  slotsOver,
  campReadoutLine,
  // M8 — the overworld action economy (D35) · D72 unified onto SkillDef
  overworldCostOf,
  resolveKnob,
  cooldownRemaining,
  scoutedTier,
  campSkillUsesLeft,
  fatigueTier,
  projectDossier,
  attentionCount,
  captainsJournal,
  projectManifest,
  getVessel,
  availableSkills,
  triage,
  isHealer,
  combatRoster,
  // M10 — the gold economy verbs (D30/D34) + theft (D30)
  merchantBuy,
  // D61 — market access + the Merchant buy/sell faucet
  merchantSell,
  merchantPrice,
  sellPrice,
  effectiveMarketTier,
  getMaterial,
  bankerEngageInterest,
  bankerBorrow,
  bankerProtect,
  // D62 — the Noble's per-expedition Influence (presence accrual + Patronize)
  patronize,
  primaryJobOf,
  influenceTier,
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
  // D77 — the equip surface verbs (pure core; the scene only calls + redraws)
  equip,
  unequip,
  type RunState,
  type MapNode,
  type NodePreview,
  type RestResult,
  type InPlaceRestResult,
  type EventOutcome,
  type EventChoice,
  type EventKind,
  type Unit,
  type SkillDef,
  type Guild,
  type Ledger,
  type RouteForecast,
  type UpkeepLine,
  type JournalConcern,
  type EquipSlot,
} from "../../core";
import { fitText, clearLayer } from "../ui";
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

/** Buyable Market stock (D61) — trap kits first (the headline), then the Medic's herbs. */
const MARKET_STOCK = ["trap-kit", "salve", "stimulant", "antidote"];

/** One action row inside a collapsible camp category drawer (Recovery/Intel/Economy). */
interface CampAction {
  /** The button label — already tagged with the acting member (` · Name`). */
  label: string;
  /** False greys the row (e.g. a market verb with no market, an unaffordable cost). */
  enabled: boolean;
  onClick: () => void;
  /** The hover hint explaining what it does (and why it's greyed, when it is). */
  tip: string;
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
/**
 * Does this skill aim at a *map node* on the overworld (the Survey beat's node-picker),
 * vs. a no-target camp action (the recovery drawer)? A **dual-surface** skill (D74, the
 * Scout's Recon) is node-aimed by its `survey` overworld face even though its base `target`
 * is `self` (for combat); a camp-targeted skill (Forage) is node-aimed by `target`.
 */
function isNodeAimedOverworld(s: SkillDef): boolean {
  return s.overworldEffect?.kind === "survey" || s.target === "camp";
}

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
  /**
   * Per-category drawer open-state on the camp/survey beats (the collapsible action
   * groups): Recovery, Intel, Economy. Each verb sits **directly** in its category — one
   * level of nesting, no sub-drawers. Default **open** so the everyday verbs are one
   * glance away. Keyed by drawer id; persists across re-renders.
   */
  private campDrawers: Record<string, boolean> = { recovery: true, intel: true, economy: true };

  // The Captain's Tent (D58): the one deep-info hub, an in-scene overlay. The active
  // tab, where to return on close, and the embedded dossier view (so it tears down).
  private tentTab: TentTab = "party";
  private tentReturn: (() => void) | null = null;
  private tentDossier?: PartyDossierView;

  // The Market overlay (the gated supply shop, D61): the beat to return to on close,
  // and the per-item buy quantity the +/− steppers drive (reset each time it opens).
  private marketReturn: (() => void) | null = null;
  private marketQty: Record<string, number> = {};

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
    clearLayer(this.overlay);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 10;
    const w = 680;
    const padX = 34;
    const intro = "An expedition is an economic routing problem: can you afford the route and a rest at its end?";
    const bullets = [
      "The map is fogged — deeper nodes hide until your intel reaches them.",
      "Pick a node to Make Camp, then End the Night to face it (fight · rest · event).",
      "After it resolves, Survey: read the forecast, rest in place, survey ahead — then Break Camp.",
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
        clearLayer(this.overlay);
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
    clearLayer(this.nodeObjects);
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

  /**
   * Icon key + circle tint per event kind (M11) — a **total** map so a new event
   * kind can't silently inherit the thief glyph: adding one to {@link EventKind}
   * fails to compile until it has a visual here. (Colours stay render-side; the
   * core record carries no presentation.)
   */
  private static readonly EVENT_VISUALS: Record<EventKind, { key: IconKey; color: number }> = {
    thief: { key: "thief", color: COLOR.captive },
    shop: { key: "shop", color: COLOR.gold },
    recruiter: { key: "recruiter", color: COLOR.info },
    story: { key: "story", color: COLOR.captive },
    toll: { key: "toll", color: COLOR.gold },
    patron: { key: "patron", color: COLOR.gold },
    // Authored Hollow Mill event nodes (D52) — the pick-one camp + the Merchant town.
    provision: { key: "shop", color: COLOR.gold },
    town: { key: "recruiter", color: COLOR.gold },
  };

  /** Icon key + circle tint for an event node, keyed by which event it runs (M11). */
  private eventVisual(node: MapNode): { key: IconKey; color: number } {
    return OverworldScene.EVENT_VISUALS[eventForNode(this.run.seed, node, influenceTier(this.run.overworld.influence)).kind];
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
    clearLayer(this.nodeObjects);
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
    clearLayer(this.overlay);
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
    this.setHint("Make Camp: provision, heal, visit the Market, glance the ledger — then End the Night.");

    const cx = this.scale.width / 2;
    const panelW = this.scale.width - 40; //  ~760 — nearly full width
    const panelTop = 60;
    const panelBottom = this.scale.height - 16; // ~584 — nearly full height
    const top = 90;
    const colX = cx - panelW / 2 + 30;
    const rowH = 30;

    // --- Left column: the action drawers --------------------------------------
    const actionsBottom = this.renderCampActions(colX, top, rowH);

    // --- Right column: the "different areas" (D58) ----------------------------
    // Deep-links to the Captain's Tent tabs, the Market and the route map — the *places
    // you go*, kept on the right, apart from the left column's *actions you take here*, so
    // the two purposes read distinctly at a glance.
    const areasBottom = this.renderAreaLinks(cx + 60, top + 8, () => this.renderCamp());

    // The captain's running to-do spans the full width, so it sits below *both* columns.
    this.renderCaptainsJournal(colX, Math.max(actionsBottom, areasBottom) + 12, panelW - 60);

    // --- End the Night — the prep→event gate (D46); anchored to the panel's bottom ---
    // For combat the night doesn't *end* — it erupts — so the wording stays "Begin
    // Mission" (D45 fork 2); rest/event "End the Night" into their payload.
    const commitLabel = isCombat
      ? "End the Night — Begin Mission"
      : node.kind === "event"
        ? "End the Night — Approach the Event"
        : "End the Night — Rest";
    const commit = this.makeTextButton(cx, panelBottom - 30, 260, 34, commitLabel, COLOR.successDeep, COLOR.success, () => this.commit());
    this.campObjects.push(commit);

    // A near-full-screen box so the camp doesn't read as cramped: content sits at the top,
    // the turn-close primary anchors the bottom. Added last; its low depth keeps it behind.
    this.campObjects.push(
      this.add.rectangle(cx, (panelTop + panelBottom) / 2, panelW, panelBottom - panelTop, COLOR.surface, 0.96).setStrokeStyle(2, COLOR.border).setDepth(8),
    );
  }

  /**
   * The right-hand **areas** column (D58): one-click deep-links to the Captain's Tent
   * tabs (Party / Stores / Ledger) and the route map — the *places you go*, kept on the
   * right and apart from the left column's *actions you take here*, so the two purposes
   * don't blur. Shared by both camp beats; `rerender` is the beat to return to on close.
   * Returns the y-centre of the last link (for sizing the content below it).
   */
  private renderAreaLinks(tx: number, top: number, rerender: () => void): number {
    const w = 240;
    const links: { label: string; onClick: () => void; tip: string }[] = [
      { label: this.tentButtonLabel(), onClick: () => this.openTent(rerender, "party"), tip: "Open the Captain's Tent on the Party dossier — HP, fatigue, conditions, jeopardy, growth. Its tab bar reaches Stores, Ledger and Map. ⚠ marks anyone hurt, dying or captured." },
    ];
    // Market — a *place you visit*, listed only when you have access (a market node or a
    // Merchant in the party). Hidden otherwise, so trap-kit/herb restock is a real
    // logistics gate: no access ⇒ no buying, lean on what you carry and looted.
    if (effectiveMarketTier(this.campNode ?? currentNode(this.run), this.run.party) !== "none") {
      links.push({ label: "Market", onClick: () => this.openMarket(rerender), tip: "Buy supplies (trap kits, herbs) and sell salvage. Only open with market access — a market node, or a Merchant who opens one anywhere. Stock up: you may not pass a market again soon." });
    }
    links.push(
      { label: "Stores", onClick: () => this.openTent(rerender, "stores"), tip: "Caravan stores — party & storage caps, carried traps and herbs (with slots), and the purse (a Captain's Tent tab)." },
      { label: "Ledger", onClick: () => this.openTent(rerender, "ledger"), tip: "Gold flow (realized + projected) and the route forecast; cross Upkeep lines off here (a Captain's Tent tab)." },
      { label: "Review Route Map", onClick: () => this.reviewMap(rerender), tip: "Look at the overworld node map (read-only) — route, reachable nodes, and fog. Click Back to return." },
    );
    links.forEach((l, i) => this.campButton(tx, top + i * 30, w, 24, l.label, true, l.onClick, l.tip));
    return top + (links.length - 1) * 30;
  }

  /**
   * The camp actions, grouped into collapsible **category drawers**: Recovery (cook /
   * heal) then Economy (the Banker/Noble finance verbs). Each drawer shows a count and
   * hides entirely when it holds nothing the party can do. (Market trade lives in the
   * gated Market overlay, reached from the areas column.) Returns the `y` past the last row.
   */
  private renderCampActions(colX: number, top: number, rowH: number): number {
    let y = top;
    y = this.renderDrawer("recovery", "Recovery", colX, y, rowH, this.campRecoveryActions(), () => this.renderCamp());
    y = this.renderEconomyDrawer(colX, y, rowH);
    return y + 8;
  }

  /**
   * The **Recovery** actions on the camp beat: each meta camp skill (the Chef's Cook
   * Stew — morale + a banked heal) and the healer's fatigue-fuelled Triage (distinct
   * from the universal Rest). Job-gated verbs are simply absent when no member can
   * perform them; each is tagged with the member who acts (and, for Triage, tires).
   */
  private campRecoveryActions(): CampAction[] {
    const out: CampAction[] = [];
    for (const u of this.run.party) {
      // No-target overworld skills only (Cook Stew etc.); node-targeting Survey lives on the
      // Intel/survey screen, not this immediate-action drawer (D72).
      for (const skill of this.overworldCampSkills(u)) {
        // Costless signature actions are per-node capped (D35) — disable when spent, and
        // badge the label with the uses left so the limiter is legible.
        const left = campSkillUsesLeft(this.run.overworld, skill);
        const capped = Number.isFinite(left);
        const usesTag = capped && skill.usesPerNode! > 1 ? `  (${left} left)` : "";
        const tip = capped
          ? `${skill.name} — ${skill.description} (${left} use${left === 1 ? "" : "s"} left tonight; resets when you Break Camp.)`
          : `${skill.name} — ${skill.description}`;
        out.push({ label: `${skill.name} · ${u.name}${usesTag}`, enabled: left > 0, onClick: () => this.useCampSkill(u, skill), tip });
      }
    }
    const healer = this.triageActor();
    if (healer) {
      const someoneWounded = combatRoster(this.run).some((u) => u.hp < u.maxHp);
      const tip = someoneWounded
        ? `${healer.name} (healer) spends fatigue to mend the most-wounded fighter — more the worse the wound. Pure stamina, no Rest Points; a worn-out healer must rest first.`
        : "No wounded fighter to triage.";
      out.push({ label: `Triage · ${healer.name} (fatigue)`, enabled: someoneWounded, onClick: () => this.doTriage(healer), tip });
    }
    return out;
  }

  /**
   * The **Economy** drawer on the camp beat: the Banker's purse-finance verbs and the
   * Noble's Patronize — each shown only when that specialist is aboard, tagged with who
   * works it (single nesting, no sub-drawer). The everyday market trade (buy supplies /
   * sell salvage) lives in the gated **Market** overlay, not here. Hidden entirely when
   * the party fields no financier. Returns the `y` past it.
   */
  private renderEconomyDrawer(colX: number, y: number, rowH: number): number {
    const banker = this.jobActor("banker");
    const noble = this.jobActor("noble");
    if (!banker && !noble) return y;
    const count = (banker ? 3 : 0) + (noble ? 1 : 0);
    y = this.drawerHeader(colX, y, 360, "economy", "Economy", count, () => this.renderCamp());
    if (!this.campDrawers.economy) return y;
    const childX = colX + 14;
    const childW = 346;
    // The Banker's purse-finance verbs (D30) — directly under Economy (single nesting),
    // tagged with the Banker who works them; shown only when one is aboard.
    if (banker) {
      this.campButton(childX, y, childW, 24, `Invest the Purse · ${banker.name}`, true, () => this.bankerInterest(), "Banker: the carried purse accrues flat interest each node-step. Purse only — never the treasury.");
      y += rowH;
      this.campButton(childX, y, childW, 24, `Borrow 40g · ${banker.name}`, true, () => this.bankerBorrow40(), "Banker: overspend now; auto-repaid from incoming run gold.");
      y += rowH;
      this.campButton(childX, y, childW, 24, `Guard the Purse (${ECONOMY.banker.protectionCost}g) · ${banker.name}`, this.run.camp.gold >= ECONOMY.banker.protectionCost, () => this.bankerProtect(), "Banker: blunt a thief's skim — battle thief and event node alike.");
      y += rowH;
    }
    // The Noble's Patronize (D62) — gold → Influence, once per node; tagged with the Noble.
    if (noble) {
      const patronCost = ECONOMY.noble.patronizeCost;
      const patronTip = `Noble: court patrons — spend ${patronCost}g for +${ECONOMY.noble.patronizeYield} Influence (once per node). A Noble also earns Influence passively as you travel. Influence never pays Upkeep; it sways enemies mid-battle.`;
      this.campButton(childX, y, childW, 24, `Patronize (${patronCost}g → +${ECONOMY.noble.patronizeYield} Influence) · ${noble.name}`, this.run.camp.gold >= patronCost, () => this.patronize(), patronTip);
      y += rowH;
    }
    // The Banker's purse-state, surfaced in context (D58).
    const eco = this.run.overworld;
    const bank: string[] = [];
    if (eco.interestPerStep > 0) bank.push(`Interest +${eco.interestPerStep}g/step`);
    if (eco.debt > 0) bank.push(`Debt ${eco.debt}g`);
    if (eco.protection > 0) bank.push(`Protection ${Math.round(eco.protection * 100)}%`);
    if (eco.influence > 0 || noble) bank.push(`Influence ${eco.influence} (${influenceTier(eco.influence)})`);
    if (bank.length) {
      this.campObjects.push(this.add.text(childX, y, bank.join("   ·   "), { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(11));
      y += rowH;
    }
    return y;
  }

  /**
   * A collapsible **category drawer** header: a ▾/▸ chevron, the category name, and a
   * count of the actions inside. Returns the `y` past the header; the caller renders the
   * child rows only when the drawer is open. `rerender` redraws the owning beat (camp or
   * survey) when the drawer is toggled.
   */
  private drawerHeader(x: number, y: number, w: number, id: string, label: string, count: number, rerender: () => void): number {
    const open = this.campDrawers[id] ?? true;
    const glyph = open ? ICON.collapse.glyph : ICON.expand.glyph;
    this.campButton(x, y, w, 24, `${glyph}  ${label}  (${count})`, true, () => { this.campDrawers[id] = !open; rerender(); }, `${label}: ${count} action${count === 1 ? "" : "s"} here — click to ${open ? "collapse" : "expand"}.`);
    return y + 30;
  }

  /**
   * Render a collapsible category drawer of simple action rows (the shared path for
   * Recovery and Intel). Draws **nothing** when the category is empty — an action the
   * party can't field is no drawer at all. Returns the `y` past it.
   */
  private renderDrawer(id: string, label: string, colX: number, y: number, rowH: number, actions: CampAction[], rerender: () => void): number {
    if (actions.length === 0) return y;
    y = this.drawerHeader(colX, y, 360, id, label, actions.length, rerender);
    if (this.campDrawers[id] ?? true) {
      for (const a of actions) {
        this.campButton(colX + 14, y, 346, 24, a.label, a.enabled, a.onClick, a.tip);
        y += rowH;
      }
    }
    return y;
  }

  /**
   * The **Captain's Journal** (D58 surfacing) — the party's own nagging state laid
   * out as the captain's running to-do, worst-first: worn gear piling up, a fading
   * companion, someone left captured. These are *accidental blindness*, not enemy
   * fog (D48), so they're surfaced freely. Pure facts come from {@link captainsJournal};
   * this only adds the Layer-2 grumble. Draws **nothing** when nothing nags
   * (anti-agony: a glance, never a chore). Returns the `y` past it.
   */
  private renderCaptainsJournal(x: number, top: number, width: number): number {
    const concerns = captainsJournal(this.run);
    if (concerns.length === 0) return top;
    this.campObjects.push(
      this.add.text(x - 10, top, "Captain's Journal", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
    );
    let y = top + 16;
    for (const c of concerns) {
      const line = this.add
        .text(x - 6, y, `• ${this.journalLine(c)}`, { color: this.journalColor(c.severity), fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 4, wordWrap: { width } })
        .setOrigin(0, 0)
        .setDepth(11);
      this.campObjects.push(line);
      y += line.height + 6;
    }
    return y + 6;
  }

  private journalColor(severity: JournalConcern["severity"]): string {
    return severity === "urgent" ? INK.danger : severity === "warning" ? INK.ember : INK.muted;
  }

  /** The captain's grumble for one concern — Layer-2 flavor over the canon facts. */
  private journalLine(c: JournalConcern): string {
    const nights = (n: number) => `${n} night${n === 1 ? "" : "s"}`;
    switch (c.kind) {
      case "gear-wear":
        return `Gear's wearing thin (${c.value}) — we should make a rest node to set it right.`;
      case "dying":
        return `${c.subject} is fading — ${nights(c.value)} before we lose them. We need a cleric.`;
      case "rescue":
        return c.value > 0
          ? `${c.subject} is still in enemy hands — ${nights(c.value)} to mount the rescue.`
          : `${c.subject} is still in enemy hands — they're counting on a rescue.`;
    }
  }

  /** A human-readable cost line for an overworld skill (cooldown + fatigue + gold), D72. */
  private costReadout(skill: SkillDef, actor: Unit): string {
    const cost = overworldCostOf(skill);
    const cd = cooldownRemaining(this.run.overworld, skill.id);
    const cdStr = cd > 0 ? `${cd} node${cd === 1 ? "" : "s"}` : "ready";
    const parts = [`cd: ${cdStr}`];
    const baseFat = cost.fatigue ?? 0;
    if (baseFat > 0) {
      // D73: a clearing verb costs only its base fatigue; flag a tired actor since the bite is the
      // deferred consequence (pricier rest-heal, carryover, the Exhausted Slow), not a surcharge.
      const tier = fatigueTier(actor.fatigue);
      const tired = tier === "Weary" || tier === "Exhausted";
      parts.push(`fatigue: ${baseFat}${tired ? " (tired)" : ""}`);
    }
    const gold = resolveKnob(cost.gold, this.run);
    if (gold > 0) parts.push(`gold: ${gold}`);
    return parts.join(", ");
  }

  /** Why an overworld skill would refuse right now (cooldown / gold), or null. */
  private refusal(skill: SkillDef, _actor: Unit): string | null {
    const cost = overworldCostOf(skill);
    const cd = cooldownRemaining(this.run.overworld, skill.id);
    if (cd > 0) return `On cooldown — ${cd} more node${cd === 1 ? "" : "s"}.`;
    // D73: fatigue never refuses an action (no lock) — over-extension is paid via consequences.
    const gold = resolveKnob(cost.gold, this.run);
    if (gold > 0 && this.run.camp.gold < gold) return `Not enough gold (${gold}g).`;
    return null;
  }

  /** Units that can act on the overworld — alive and not bound (D7). */
  private activeUnits(): Unit[] {
    return this.run.party.filter((u) => u.alive && !u.captured);
  }

  /**
   * The active party member whose **primary job** is `jobId` — the one who performs (and,
   * for a fatigue-priced verb, tires from) that job's action. The render tags the button
   * with *who* acts and, when this returns `undefined`, hides the action entirely: a verb
   * the party can't field a job for isn't a greyed tease, it simply isn't shown.
   */
  private jobActor(jobId: string): Unit | undefined {
    return this.activeUnits().find((u) => primaryJobOf(u) === jobId);
  }

  /**
   * A unit's **node-targeting** overworld skills (D72) — Survey and any future recon verb
   * (skill target `camp`, aimed at a *map* node via opts). Surfaced on the intel/survey
   * screen, **not** the no-target recovery drawer. Sourced from {@link availableSkills}, so
   * the gate (class + capability + unlock) is the single projection — no hardcoded id.
   */
  private overworldNodeSkills(u: Unit): SkillDef[] {
    return availableSkills(u, "overworld").filter((s) => isNodeAimedOverworld(s));
  }

  /** A unit's **no-target** overworld camp skills (Cook Stew etc.) — the recovery drawer (D72). */
  private overworldCampSkills(u: Unit): SkillDef[] {
    return availableSkills(u, "overworld").filter((s) => !isNodeAimedOverworld(s));
  }

  /**
   * The acting unit for Survey (D72): an active unit that can perform a node-targeting
   * overworld skill (the Scout's Survey, via {@link overworldNodeSkills} — the class gate
   * lives in the projection now), the highest-Intelligence among them. `undefined` when the
   * party fields none — the render then hides the Intel drawer.
   */
  private surveyActor(): Unit | undefined {
    const eligible = this.activeUnits().filter((u) => this.overworldNodeSkills(u).length > 0);
    if (eligible.length === 0) return undefined;
    return eligible.reduce((best, u) => (u.intelligence > best.intelligence ? u : best), eligible[0]);
  }

  /** The camp "Party" button label, badged with the count needing a look (⚠N). */
  private partyButtonLabel(): string {
    const n = attentionCount(projectDossier(this.run));
    return n > 0 ? `Party  ⚠${n}` : "Party";
  }

  /**
   * Open the party dossier (D-info-surfacing). **Page mode:** launch the dossier on
   * top and pause this scene, so the camp panel is preserved exactly and restored on
   * close (a clean seam for the future live-overlay mode — launch the same scene
   * without pausing). The dossier reads the live run, so its numbers are current.
   */
  // --- The Captain's Tent (D58): the one deep-info hub ------------------------

  /** The camp/survey button that opens the Tent, badged with anyone needing a look. */
  private tentButtonLabel(): string {
    const n = attentionCount(projectDossier(this.run));
    return n > 0 ? `Captain's Tent  ⚠${n}` : "Captain's Tent";
  }

  /**
   * Open the Captain's Tent — the run's single deep-info hub, an in-scene **overlay**
   * (the chosen idiom: it floats over the live camp, no scene swap). One verb opens
   * it; a tab bar (Party · Stores · Ledger · Map) switches view. It converges what
   * were three scattered surfaces — the dossier scene, the inventory panel and its
   * nested ledger — under one frame, each datum single-sourced to its tab.
   */
  private openTent(returnTo: () => void, tab: TentTab = "party"): void {
    this.tentReturn = returnTo;
    this.tentTab = tab;
    this.renderTent();
  }

  /** Tear down the Tent and hand control back to whoever opened it (camp / survey). */
  private closeTent(): void {
    this.tentDossier?.destroy();
    this.tentDossier = undefined;
    clearLayer(this.overlay);
    const back = this.tentReturn;
    this.tentReturn = null;
    back?.();
  }

  private selectTentTab(tab: TentTab): void {
    if (tab === "map") {
      // The map wants the whole board, not a panel — hand off to the read-only route
      // view (its ← Back reopens the Tent on Party, so Map reads as a sibling tab).
      const back = this.tentReturn ?? (() => this.renderCamp());
      this.tentDossier?.destroy();
      this.tentDossier = undefined;
      clearLayer(this.overlay);
      // ← Back first restores the camp/survey panel (and its title — reviewMap
      // retitled the bar "Route Map · reviewing"), then re-floats the Tent over it.
      this.reviewMap(() => { back(); this.openTent(back, "party"); });
      return;
    }
    this.tentTab = tab;
    this.renderTent();
  }

  /** (Re)draw the Tent: the frame + tab bar, then the active tab's body. */
  private renderTent(): void {
    this.tentDossier?.destroy();
    this.tentDossier = undefined;
    clearLayer(this.overlay);

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const w = 760;
    const h = Math.min(this.scale.height - 24, 540);
    const left = cx - w / 2;
    const top = cy - h / 2;

    // Full-screen backdrop (dims + swallows clicks to the camp behind) + the frame.
    const backdrop = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, COLOR.black, 0.55).setDepth(22).setInteractive();
    this.overlay.push(
      backdrop,
      this.add.rectangle(cx, cy, w, h, COLOR.surface, 0.98).setStrokeStyle(2, COLOR.gold).setDepth(23),
      this.add.text(left + 24, top + 22, "Captain's Tent", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0, 0.5).setDepth(25),
    );
    this.overlay.push(this.makeTextButton(left + w - 70, top + 22, 96, 28, "Close", COLOR.surfaceRaised, COLOR.border, () => this.closeTent()).setDepth(26));

    // Tab bar — Map sits among the panel tabs even though it hands off to the board.
    const tabs: { id: TentTab; label: string }[] = [
      { id: "party", label: this.partyButtonLabel() },
      { id: "stores", label: "Stores" },
      { id: "ledger", label: "Ledger" },
      { id: "map", label: "Map" },
    ];
    const tabY = top + 58;
    tabs.forEach((t, i) => {
      const active = t.id === this.tentTab;
      const btn = this.makeTextButton(left + 24 + 70 + i * 144, tabY, 134, 30, t.label, active ? COLOR.btnFill : COLOR.surfaceRaised, active ? COLOR.gold : COLOR.border, () => this.selectTentTab(t.id));
      this.overlay.push(btn.setDepth(26));
    });
    const rule = this.add.graphics().setDepth(24);
    rule.lineStyle(1, COLOR.borderSoft, 0.9);
    rule.lineBetween(left + 16, tabY + 22, left + w - 16, tabY + 22);
    this.overlay.push(rule);

    // Content bounds below the tab bar; each body lays out inside it.
    const contentTop = tabY + 34;
    const bounds = new Phaser.Geom.Rectangle(left + 8, contentTop, w - 16, top + h - 16 - contentTop);
    if (this.tentTab === "party") this.drawTentParty(bounds);
    else if (this.tentTab === "stores") this.drawTentStores(bounds);
    else this.drawTentLedger(bounds);

    this.setHint("Captain's Tent — Party, Stores, Ledger, Map. Close (or Esc) returns to camp.");
    this.input.keyboard?.once("keydown-ESC", () => this.closeTent());
  }

  /** Party tab — the bounds-driven dossier view, embedded (the Tent owns the chrome).
   *  The equip intents (D77) call the pure core verbs and redraw the Tent; all the
   *  rules (slot-match, unique-gating, cap-safe swap) live in {@link equip}/{@link unequip}. */
  private drawTentParty(bounds: Phaser.Geom.Rectangle): void {
    this.tentDossier = new PartyDossierView(this, {
      bounds,
      mode: "overlay",
      embedded: true,
      data: projectDossier(this.run),
      onClose: () => this.closeTent(),
      onEquip: (unitId, itemId) => {
        const unit = this.run.party.find((u) => u.id === unitId);
        if (unit && equip(this.run.inventory, unit, itemId, { party: this.run.party })) this.renderTent();
      },
      onUnequip: (unitId, slot: EquipSlot) => {
        const unit = this.run.party.find((u) => u.id === unitId);
        if (unit && unequip(this.run.inventory, unit, slot)) this.renderTent();
      },
    });
  }

  /** Stores tab — the caravan manifest (party/storage caps, carried stock, purse). */
  private drawTentStores(b: Phaser.Geom.Rectangle): void {
    const m = projectManifest(this.run, this.caravanInfo());
    const pad = 22;
    const leftX = b.left + pad;
    const rightX = b.right - pad;
    const rowH = 22;
    const partyStr = m.partyCapacity != null ? `Party ${m.partyCount}/${m.partyCapacity}` : `Party ${m.partyCount}`;
    const vessel = m.vesselLabel ? `${m.vesselLabel} · ` : "";
    const g = this.add.graphics().setDepth(24);
    this.overlay.push(
      g,
      this.add.text(leftX, b.top + 12, `${vessel}${partyStr}  ·  Storage ${m.storageUsed}/${m.storageCap} (free ${m.storageFree})`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
      this.add.text(rightX, b.top + 12, `Purse ${m.purse}g`, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(1, 0.5).setDepth(25),
    );
    let y = b.top + 30;
    if (m.storageFree <= 0) {
      this.overlay.push(this.add.text(leftX, y, "⚠ Storage full — use or sell before buying.", { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
      y += 18;
    }
    g.lineStyle(1, COLOR.borderSoft, 0.9);
    g.lineBetween(leftX, y, rightX, y);
    y += 16;
    for (const grp of m.groups) {
      this.overlay.push(this.add.text(leftX, y, grp.title, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
      y += rowH;
      for (const it of grp.items) {
        const dim = it.count <= 0;
        const slotStr = it.slots > 0 ? `  (${it.slots} sl)` : "";
        this.overlay.push(
          this.add.text(leftX + 8, y, it.name, { color: dim ? INK.disabled : INK.bright, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
          this.add.text(leftX + 130, y, `${it.effect} · ${it.recoverable ? "recoverable" : "consumed"}`, { color: dim ? INK.disabled : INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(25),
          this.add.text(rightX, y, `×${it.count}${slotStr}`, { color: dim ? INK.disabled : INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
        );
        y += rowH;
      }
    }
  }

  /** Ledger tab — gold flow (realized + projected) + the route forecast (D45/D48). */
  private drawTentLedger(b: Phaser.Geom.Rectangle): void {
    const node = this.campNode ?? currentNode(this.run);
    const merchantReady = node.kind === "rest" && this.run.party.some((u) => u.alive && u.jobId === "merchant") && cooldownRemaining(this.run.overworld, "market") === 0;
    const ledger: Ledger = buildLedger(this.run, { influence: this.run.overworld.influence, marketReady: merchantReady });
    const pad = 22;
    const leftX = b.left + pad;
    const rightX = b.right - pad;
    const colX = rightX - 86;
    const rowH = 22;
    const g = this.add.graphics().setDepth(24);
    this.overlay.push(
      g,
      this.add.text(leftX, b.top + 10, `Balance  ${ledger.balance}g`, { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
      this.add.text(rightX, b.top + 10, `Influence ${ledger.influence} · never pays Upkeep`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
    );
    g.lineStyle(1, COLOR.borderSoft, 0.9);
    g.lineBetween(leftX, b.top + 24, rightX, b.top + 24);
    g.lineBetween(leftX, b.top + 26, rightX, b.top + 26);

    let y = this.drawLedgerRows(ledger, g, { leftX, rightX, colX, rowH, cx: b.centerX, pad, w: b.width }, b.top + 26 + 18);
    y += 8;
    this.overlay.push(this.add.text(leftX, y, "Forecast", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
    y += 16;
    this.overlay.push(this.add.text(leftX, y, this.forecastSummary(ledger.forecast), { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 3, wordWrap: { width: rightX - leftX } }).setOrigin(0, 0).setDepth(25));
    if (ledger.marketReady) {
      this.overlay.push(this.makeTextButton(leftX + 90, b.bottom - 16, 170, 28, "Open Market", COLOR.btnFill, COLOR.gold, () => { this.tentDossier?.destroy(); this.tentDossier = undefined; const back = this.tentReturn ?? (() => this.renderCamp()); this.tentReturn = null; this.openMarket(back); }).setDepth(26));
    }
  }

  private useCampSkill(actor: Unit, skill: SkillDef): void {
    // Gated by the per-node cap (D35): the signature action levels its owner now
    // (D32/D53) but can't be spammed for unlimited gold/morale/XP.
    const res = this.loop.useCampSkill(actor, skill);
    this.renderCamp();
    this.setHint(res.applied ? `${res.detail ?? "Done."}` : `Can't: ${res.reason ?? "refused."}`);
  }

  /** Sell the whole valuables stack into purse gold at the current node's market (D61). */
  private sellValuables(): void {
    let total = 0;
    let sold = 0;
    let levels = 0;
    while (countOf(this.run.inventory, "valuables") > 0) {
      const res = merchantSell(this.run, "valuables");
      if (!res.applied) break;
      total += res.earned ?? 0;
      sold += 1;
      levels += res.levels ?? 0;
    }
    this.renderMarket();
    const lvl = levels > 0 ? ` (Merchant +${levels} level${levels === 1 ? "" : "s"})` : "";
    this.setHint(sold > 0 ? `Sold ${sold} valuables for ${total}g.${lvl}` : "Can't sell here.");
  }

  /** An active healer (the Triage job gate) — a Medic-class member, or undefined if none. */
  private triageActor(): Unit | undefined {
    return this.activeUnits().find((u) => isHealer(u));
  }

  /** The healer spends fatigue (worn out) to mend the most-wounded fighter (the audit pass). */
  private doTriage(healer: Unit): void {
    const res = triage(this.run, healer);
    this.renderCamp();
    if (!res.applied) return this.setHint(`Can't triage: ${res.reason}`);
    this.setHint(`${healer.name} triaged +${res.healed} HP — worn out (+${res.fatigueSpent} fatigue).`);
  }

  // --- The Market overlay (D61): the gated supply shop ----------------------

  /** Open the Market overlay over the current beat; `returnTo` redraws it on close. */
  private openMarket(returnTo: () => void): void {
    this.marketReturn = returnTo;
    this.marketQty = {};
    this.setHint("Market — buy supplies & sell salvage. Stock up: you may not pass a market again soon. Close (or Esc) returns.");
    this.input.keyboard?.once("keydown-ESC", () => this.closeMarket());
    this.renderMarket();
  }

  /** Tear down the Market and hand control back to whoever opened it (camp / survey). */
  private closeMarket(): void {
    clearLayer(this.overlay);
    const back = this.marketReturn;
    this.marketReturn = null;
    back?.();
  }

  /** Buy `qty` of `id` at the node's tier (stops early if gold/storage runs out). */
  private marketBuy(id: string, qty: number): void {
    const tier = effectiveMarketTier(this.campNode ?? currentNode(this.run), this.run.party);
    let bought = 0;
    let reason = "";
    for (let i = 0; i < qty; i++) {
      const res = merchantBuy(this.run, id, tier);
      if (!res.applied) { reason = res.reason ?? ""; break; }
      bought++;
    }
    if (bought > 0) this.marketQty[id] = 1;
    this.renderMarket();
    this.setHint(bought > 0 ? `Bought ${bought}× ${getMaterial(id)?.name ?? id}.` : `Can't: ${reason}`);
  }

  /**
   * (Re)draw the **Market** overlay (D61): a gated supply shop. Buy trap kits + the
   * Medic's herbs in bulk (a +/− stepper per row, capped by gold), and sell looted
   * salvage — all at the node's effective market tier. Access (a market node or a
   * Merchant) is the gate; with none it shows why and offers only Close. Mirrors the
   * Tent overlay's frame/teardown so the two read as siblings.
   */
  private renderMarket(): void {
    clearLayer(this.overlay);
    const tier = effectiveMarketTier(this.campNode ?? currentNode(this.run), this.run.party);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const w = 560;
    const h = 400;
    const left = cx - w / 2;
    const top = cy - h / 2;

    const backdrop = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, COLOR.black, 0.55).setDepth(22).setInteractive();
    this.overlay.push(
      backdrop,
      this.add.rectangle(cx, cy, w, h, COLOR.surface, 0.98).setStrokeStyle(2, COLOR.gold).setDepth(23),
      this.add.text(left + 24, top + 24, "Market", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0, 0.5).setDepth(25),
      this.add.text(left + 122, top + 26, `· ${tier === "none" ? "no market" : `${tier} market`}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
    );
    this.overlay.push(this.makeTextButton(left + w - 60, top + 26, 96, 28, "Close", COLOR.surfaceRaised, COLOR.border, () => this.closeMarket()).setDepth(26));

    const leftX = left + 24;
    if (tier === "none") {
      this.overlay.push(this.add.text(leftX, top + 80, "No market here — route to a market node, or bring a Merchant to open one anywhere.", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 4, wordWrap: { width: w - 48 } }).setOrigin(0, 0).setDepth(25));
      return;
    }

    const price = merchantPrice(tier);
    let y = top + 64;
    this.overlay.push(this.add.text(leftX, y, `Buy  ·  ${price}g each`, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
    y += 28;
    for (const id of MARKET_STOCK) {
      const mat = getMaterial(id);
      if (!mat) continue;
      const owned = countOf(this.run.inventory, id);
      const room = canAdd(this.run.inventory, id);
      const affordable = Math.floor(this.run.camp.gold / price);
      const buyable = room && affordable >= 1;
      this.overlay.push(
        this.add.text(leftX, y, mat.name, { color: buyable ? INK.bright : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
        this.add.text(leftX + 150, y, `own ${owned}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
      );
      if (!buyable) {
        this.overlay.push(this.add.text(leftX + 244, y, room ? `need ${price}g` : "storage full", { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(25));
      } else {
        const qty = Math.min(affordable, Math.max(1, this.marketQty[id] ?? 1));
        this.overlay.push(this.makeTextButton(leftX + 268, y, 22, 22, "−", COLOR.surfaceRaised, COLOR.border, () => { this.marketQty[id] = Math.max(1, qty - 1); this.renderMarket(); }).setDepth(26));
        this.overlay.push(this.add.text(leftX + 292, y, `${qty}`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5, 0.5).setDepth(25));
        this.overlay.push(this.makeTextButton(leftX + 316, y, 22, 22, "+", COLOR.surfaceRaised, COLOR.border, () => { this.marketQty[id] = Math.min(affordable, qty + 1); this.renderMarket(); }).setDepth(26));
        this.overlay.push(this.makeTextButton(leftX + 392, y, 84, 22, `Buy ×${qty}`, COLOR.btnFill, COLOR.gold, () => this.marketBuy(id, qty)).setDepth(26));
      }
      y += 30;
    }

    y += 8;
    this.overlay.push(this.add.text(leftX, y, "Sell", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
    y += 28;
    const valCount = countOf(this.run.inventory, "valuables");
    const unitSell = sellPrice(getMaterial("valuables")!, tier);
    if (valCount > 0 && unitSell > 0) {
      this.overlay.push(this.add.text(leftX, y, `Valuables  ·  ×${valCount} at ${unitSell}g each`, { color: INK.bright, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
      this.overlay.push(this.makeTextButton(leftX + 392, y, 84, 22, "Sell all", COLOR.btnFill, COLOR.gold, () => this.sellValuables()).setDepth(26));
    } else {
      this.overlay.push(this.add.text(leftX, y, valCount === 0 ? "No salvage to sell." : "Salvage can't be sold here.", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
    }

    const m = projectManifest(this.run, this.caravanInfo());
    this.overlay.push(this.add.text(leftX, top + h - 22, `Purse ${m.purse}g     ·     Storage ${m.storageUsed}/${m.storageCap}`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
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

  private patronize(): void {
    const res = patronize(this.run);
    this.renderCamp();
    if (!res.applied) return this.setHint(`Can't: ${res.reason}`);
    this.setHint(`Patronized: +${res.gained} Influence (now ${this.run.overworld.influence}, ${influenceTier(this.run.overworld.influence)}). Influence never pays Upkeep.`);
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
    clearLayer(this.campObjects);
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
      case "provision": return this.showProvisionScreen();
      case "patron": return this.playPatronEvent();
      case "thief":
      default: return this.playThiefEvent();
    }
  }

  // Provision (D52/D79) — the Node 2 **traveler-gift**: an *unconditional* gift (trap kits +
  // iron weapons, the cook-stew variant only with a Cook aboard), no longer a pick-one. The
  // shared choice panel renders `eventDef().choices()` and `onEventChoice` applies it; the
  // gift lands over the full stash (D75) so Break Camp then forces the discard. Without this
  // case a `provision` node fell through to the thief handler and silently auto-resolved.
  private showProvisionScreen(): void {
    const def = this.loop.eventDef();
    this.renderEventChoicePanel(def.name, def.teaser);
  }

  // Patron's Welcome — a standing-gated boon (D62): auto-resolve the feast + report it.
  private playPatronEvent(): void {
    const res = this.loop.eventNode(); // auto-resolves the boon + records the night
    this.refreshCampText();
    const o = res.outcome;
    const lines: string[] = [o.summary];
    if (o.moraleDelta) lines.push(`Spirits lift (+${o.moraleDelta} morale).`);
    if (o.materials.length) lines.push(`A parting gift: ${o.materials.join(", ")} (sell it at a market).`);
    lines.push(`Standing now ${this.run.overworld.influence} Influence (${influenceTier(this.run.overworld.influence)}).`);
    this.showOverlay(res.def.name, lines.join("\n"), true, 520, 220, () => this.afterNode());
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

    clearLayer(this.overlay);
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
        clearLayer(this.overlay);
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
    clearLayer(this.overlay);
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
    clearLayer(this.overlay);
    this.campNode = currentNode(this.run);
    this.refreshCampText();

    this.titleText.setText(`Survey — Night ${this.run.night} · plan your route`);
    this.setHint("Survey: read the forecast, rest in place (a night's rations, repeatable), survey ahead — then Break Camp to the map.");

    const cx = this.scale.width / 2;
    const panelW = this.scale.width - 40; //  ~760 — nearly full width
    const panelTop = 60;
    const panelBottom = this.scale.height - 16; // ~584 — nearly full height
    const top = 92;
    const colX = cx - panelW / 2 + 30;
    const rowH = 30;

    const forecast = projectForecast(this.run);
    this.campObjects.push(
      this.add.text(colX - 10, top - 6, "Route forecast", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
      this.add.text(colX - 10, top + 18, this.forecastSummary(forecast), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 5, wordWrap: { width: panelW - 60 } }).setOrigin(0, 0).setDepth(11),
    );
    const colTop = top + 26 + (forecast.perEdge.length + 1) * 18 + 14;
    let y = colTop;

    // Recovery drawer: the route-planning heal (in-place rest — repeatable, costed; greys
    // at full HP / when broke). The same category vocabulary as the camp beat.
    const rest = this.inPlaceRestReadout();
    const recovery: CampAction[] = [
      { label: `Rest in place — ${rest.label}`, enabled: rest.enabled, onClick: () => this.doInPlaceRest(), tip: rest.detail },
    ];
    y = this.renderDrawer("recovery", "Recovery", colX, y, rowH, recovery, () => this.showSurvey());

    // Intel drawer: survey a reachable node — raises its preview, tightening the forecast
    // (D48). Job-gated to the Scout; the whole drawer is absent when none is aboard. Each
    // row tags the surveying Scout, whose fatigue the cost readout shows (who's wearing down).
    const surveyor = this.surveyActor();
    const intel: CampAction[] = [];
    const survey = surveyor ? this.overworldNodeSkills(surveyor)[0] : undefined;
    if (surveyor && survey) {
      for (const target of this.loop.reachable()) {
        const refusal = this.refusal(survey, surveyor);
        intel.push({ label: `${survey.name} → ${target.id} · ${surveyor.name} (${this.costReadout(survey, surveyor)})`, enabled: !refusal, onClick: () => { this.loop.useOverworldSkill(surveyor, survey, { targetNodeId: target.id }); this.showSurvey(); }, tip: refusal ?? survey.description });
      }
    }
    y = this.renderDrawer("intel", "Intel", colX, y, rowH, intel, () => this.showSurvey());

    const leftBottom = y;

    // Right column: the "different areas" — Tent tabs, the Market and the route map —
    // kept apart from the left-column actions (the same right-hand cluster Make Camp uses).
    const areasBottom = this.renderAreaLinks(cx + 60, colTop, () => this.showSurvey());

    // The captain's running to-do spans the full width, so it sits below *both* columns.
    this.renderCaptainsJournal(colX, Math.max(leftBottom, areasBottom) + 12, panelW - 60);

    // Break Camp anchors the bottom of the near-full-screen box (matching Make Camp).
    const breakBtn = this.makeTextButton(cx, panelBottom - 30, 240, 34, "Break Camp →", COLOR.successDeep, COLOR.success, () => this.breakCampToMap());
    this.campObjects.push(breakBtn);

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
      detail: "In-place rest: pay a night's rations to bank RP + a small heal (floors at ≥1). Repeatable; each rest is a node-step (ticks cooldowns). Greys at full HP / when broke.",
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

  /**
   * Break Camp → the storage-overflow discard (D75, a hard gate) → the soft
   * intent-aware night-end gate (D45) → the map. Grants land over the cap, so a
   * stash can leave a node over capacity; the player must choose what to let go
   * before they march. Within cap, this falls straight through to the soft gate.
   */
  private breakCampToMap(): void {
    if (slotsOver(this.run.inventory) > 0) {
      this.showDiscardMenu(() => this.breakCampGate());
      return;
    }
    this.breakCampGate();
  }

  /**
   * The storage-overflow discard menu (D75): the stash is over its cap because a
   * grant (a Forage haul, a traveler's gift, recovered gear) always lands. The
   * player picks what to drop — the interactive twin of {@link autoTrim} — and the
   * menu closes itself the moment the stash is back within cap, continuing to
   * `onDone`. Forced before the march so storage stays an honest, *felt* limit.
   */
  private showDiscardMenu(onDone: () => void): void {
    const inv = this.run.inventory;
    const over = slotsOver(inv);
    if (over <= 0) {
      clearLayer(this.overlay);
      return onDone();
    }

    clearLayer(this.overlay);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 10;
    const carried = Object.keys(inv.counts)
      .filter((id) => inv.counts[id] > 0)
      .sort((a, b) => (getMaterial(a)?.name ?? a).localeCompare(getMaterial(b)?.name ?? b));
    const w = 560;
    const h = 140 + carried.length * 38;

    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.97).setStrokeStyle(2, COLOR.danger).setDepth(24),
      this.add.text(cx, cy - h / 2 + 24, "Storage overflowing — let something go", { color: INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(25),
      this.add.text(cx, cy - h / 2 + 54, `Storage ${slotsUsed(inv)}/${inv.storageCap} — ${over} slot${over === 1 ? "" : "s"} over the cap. Discard until it fits to break camp.`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, align: "center", wordWrap: { width: w - 60 } }).setOrigin(0.5).setDepth(25),
    );

    let y = cy - h / 2 + 96;
    for (const id of carried) {
      const mat = getMaterial(id);
      const count = countOf(inv, id);
      const slots = mat ? slotsFor(mat, count) : count; // the row's current slot footprint (stacks pack)
      const val = mat?.saleValue ? ` · ${mat.saleValue}g ea` : "";
      const btn = this.makeTextButton(cx, y, 400, 30, `Discard 1 — ${mat?.name ?? id} ×${count} (${slots} slot${slots === 1 ? "" : "s"})${val}`, COLOR.surfaceRaised, COLOR.danger, () => {
        removeItem(inv, id, 1);
        this.refreshCampText();
        this.showDiscardMenu(onDone); // re-render; auto-closes once back within cap
      }).setDepth(26);
      // Stacked goods (a half-stack of herbs) share a slot — dropping one may not free space until the stack empties.
      btn.bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.setHint(`Drop one ${mat?.name ?? id}. Whole stacks free a slot; a partial stack frees one only when it empties. Lowest-value gear is the usual cut.`));
      this.overlay.push(btn);
      y += 38;
    }
  }

  /** The soft, intent-aware night-end gate (D45) → the map (overflow already cleared). */
  private breakCampGate(): void {
    const gate = nightEndGate(this.run);
    if (!gate.warn) return this.toMap();
    // Hard-stop with a forced look only when warranted; never a per-night chore.
    clearLayer(this.overlay);
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
    clearLayer(this.overlay);
    this.campNode = undefined;
    this.drawMap();
  }

  /** The caravan behind this run (for its vessel caps), if a guild dispatched it. */
  private caravanInfo(): { vesselLabel?: string; partyCapacity?: number } {
    if (!this.guild || !this.caravanId) return {};
    const caravan = this.guild.caravans.find((c) => c.id === this.caravanId);
    if (!caravan) return {};
    const vessel = getVessel(caravan.vesselId);
    return { vesselLabel: vessel.label, partyCapacity: vessel.capacity };
  }

  /**
   * The category/line rows — the bulk of the ledger sheet: each category header
   * (label + running total), its lines (amount, skip-strike, faint per-row rule),
   * the clickable hit-rects on Upkeep lines, and the vertical amount-column rule.
   * Draws onto the shared graphics `g`; returns the `y` just past the last row.
   */
  private drawLedgerRows(
    ledger: Ledger,
    g: Phaser.GameObjects.Graphics,
    geom: { leftX: number; rightX: number; colX: number; rowH: number; cx: number; pad: number; w: number },
    startY: number,
  ): number {
    const { leftX, rightX, colX, rowH, cx, pad, w } = geom;
    let y = startY;
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
          hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.toggleSkip(lineId));
          this.overlay.push(hit);
        }
        y += rowH;
      }
    }

    // The vertical amount-column rule down the rows region.
    g.lineStyle(1, COLOR.borderSoft, 0.45);
    g.lineBetween(colX, rowsTop, colX, y - rowH / 2);
    return y;
  }

  /** A signed gold figure for the ledger (`+5g` / `-5g`). */
  private signed(n: number): string {
    return `${n >= 0 ? "+" : ""}${n}g`;
  }

  /** Toggle a voluntary Upkeep skip (D45) — crosses the line off / restores it. */
  private toggleSkip(id: UpkeepLine["id"]): void {
    const set = new Set(this.run.camp.skippedUpkeep);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.run.camp.skippedUpkeep = [...set] as ("food" | "repairs")[];
    this.refreshCampText();
    this.setHint(set.has(id) ? `Crossed ${id} off the ledger — its gold is freed (you'll take the consequence; the gate won't nag).` : `${id} funded again.`);
    this.renderTent();
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
    // The always-on line is the four decision-relevant groups only (D58): Purse,
    // Morale, Storage/Kits, RP/Upkeep. The Banker's purse-state + Influence moved
    // into the camp's Advanced panel / ledger, where they're actionable. The format
    // is owned by core (campReadoutLine) so the battle + overworld HUDs can't drift.
    this.campText.setText(campReadoutLine(this.run));
  }

  private setHint(text: string): void {
    this.hintPanel.setResting(text);
  }

  private showOverlay(title: string, body: string, good: boolean, w = 480, h = 200, onContinue?: () => void): void {
    clearLayer(this.overlay);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 20;
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.94).setStrokeStyle(2, good ? COLOR.success : COLOR.danger).setDepth(20),
      this.add.text(cx, cy - h / 2 + 26, title, { color: good ? INK.success : INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(cx, cy + 6, body, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, align: "center", lineSpacing: 4, wordWrap: { width: w - 48 } }).setOrigin(0.5).setDepth(21),
    );
    if (onContinue) {
      const btn = this.makeTextButton(cx, cy + h / 2 - 20, 160, 30, "Continue", COLOR.successDeep, COLOR.success, () => {
        clearLayer(this.overlay);
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
