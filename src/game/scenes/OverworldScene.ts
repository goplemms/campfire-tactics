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
  campReadout,
  type CampReadout,
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
  type PreviewChange,
  type PreviewStat,
  skillEffectPreview,
  triageActionPreview,
  inPlaceRestPreview,
  bankerInterestPreview,
  bankerBorrowPreview,
  bankerProtectPreview,
  patronizePreview,
  // D77 — the equip surface verbs (pure core; the scene only calls + redraws)
  equip,
  unequip,
  // D80 — early events (the arrival layer): a light on-the-road event before the main encounter
  earlyEventForNode,
  resolveEarlyEvent,
  TRIAGE,
  type EventDef,
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
import { fitText, clearLayer, isScreenshotMode } from "../ui";
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

/** The hover-preview projection (a list of {@link PreviewChange}) lives in core; the scene
 *  only lays it out. `ReadoutStat`/`ActionPreview` alias the core names for local use. */
type ReadoutStat = PreviewStat;
type ActionPreview = PreviewChange[];

/** One action row inside a collapsible camp category drawer (Recovery/Intel/Economy). */
interface CampAction {
  /** The button label — already tagged with the acting member (` · Name`). */
  label: string;
  /** False greys the row (e.g. a market verb with no market, an unaffordable cost). */
  enabled: boolean;
  onClick: () => void;
  /** The hover hint explaining what it does (and why it's greyed, when it is). */
  tip: string;
  /** The projected effect shown on hover (arrows on the readout tiles + off-panel area). */
  preview?: ActionPreview;
  // --- Structured fields (the card-row prototype) — a verb split into readout-tile slots ---
  /** The verb, on its own (e.g. "Cook Stew"). When set, the row renders as a cost-bearing card. */
  name?: string;
  /** Who performs it (e.g. "Pip"), shown as a muted second slot. */
  actor?: string;
  /** Structured cost, rendered as fixed-order icon+number **component chips** (D&D-style). */
  costs?: ActionCost;
}

/**
 * A structured action cost (the standardized **component** model) — each present field renders as a
 * fixed-slot icon+number chip (gold / fatigue / material / cooldown), so costs read the same way and
 * line up across every action row. Absent fields show nothing; an all-absent cost reads "free".
 */
interface ActionCost {
  /** Purse gold spent. */
  gold?: number;
  /** Overworld effort accrued on the actor. */
  fatigue?: number;
  /** A consumed material (id → count), when an action spends stock. */
  material?: { id: string; n: number };
  /** Nights until it's ready again (a cooldown already ticking). */
  cooldown?: number;
}

/** The cost **components** in fixed render order — the standardized slots every action reads through. */
const COST_COMPONENTS: readonly { key: keyof ActionCost; glyph: string; ink: string; name: string }[] = [
  { key: "gold", glyph: "¤", ink: INK.gold, name: "gold" },
  { key: "fatigue", glyph: "✦", ink: INK.ember, name: "fatigue" },
  { key: "material", glyph: "◆", ink: INK.cyan, name: "material" },
  { key: "cooldown", glyph: "◷", ink: INK.muted, name: "cooldown (nights)" },
];

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
 * vs. a no-target camp action (the recovery drawer)? The Scout's **Survey** is node-aimed by
 * its `survey` effect; a camp-targeted skill (Forage) is node-aimed by its `target`.
 */
function isNodeAimedOverworld(s: SkillDef): boolean {
  return s.effect.kind === "survey" || s.target === "camp";
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

  // The prep camp's "last night's rest" recap (D80): what the arrival rest healed / fatigue it
  // shed, captured by diffing the party across `loop.choose` in enterCamp. UI-only, per-arrival.
  private arrivalRecap: string[] = [];

  // The right-side state readouts (D58): the day's opening figures (to colour each value
  // by its net move *this day*, keyed by the node we're camped at), the previous render's
  // figures (to pulse a tile the instant a value changes), and the live pulse tweens (torn
  // down with the camp so a tween never ticks a destroyed tile).
  private readoutBaseline?: CampReadout;
  private readoutBaselineKey?: string;
  private readoutLast?: CampReadout;
  private readoutTweens: Phaser.Tweens.Tween[] = [];
  // The hover-preview layer: where each readout tile sits (to arrow its gutter) + the
  // off-panel area geometry, and the transient preview objects (cleared on hover-out).
  private readoutGeom?: { x: number; cardW: number; tileCy: Partial<Record<ReadoutStat, number>>; areaX: number; areaW: number; areaTop: number };
  private previewObjects: Phaser.GameObjects.GameObject[] = [];

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
      "Pick a node to travel to; you make a Prep camp on arrival, then Begin to face it (fight · rest · event).",
      "After it resolves, the React camp: read the forecast, survey ahead — then Set Out to the map.",
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
        this.setHint("Hover a node to preview it; click to camp there. Deeper nodes are fogged until intel reaches them.");
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
    // The map has no action column to sit beside, so the caravan's figures ride the
    // top HUD line here (the camp/survey beats move them into a right-side panel).
    this.campText.setVisible(true);

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
    this.setHint("Click a node to preview it; click again to camp there. Deeper nodes are fogged — raise intel to see farther.");
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

    // Scouted marker (D80, Survey): a gold ◉ at top-left for a surveyed node — its intel is
    // sharpened and you can see a step past it, so read/unread nodes are legible at a glance.
    if (!state.visited && scoutedTier(this.run.overworld, node.id) > 0) {
      const mark = this.add.text(pos.x - radius + 2, pos.y - radius + 2, ICON.scouted.glyph, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5).setDepth(2);
      this.nodeObjects.push(mark);
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
    // Survey's effect B (D80): a scouted node also tells you what's on the road in.
    const road = p.earlyEventHint ? `   ·   on the road: ${p.earlyEventHint}` : "";
    if (p.kind === "rest") return `Layer ${p.layer} · Rest — ${p.restHint}${road}`;
    if (p.kind === "event") return `Layer ${p.layer} · Event — ${p.eventHint}`;
    const parts = [`Layer ${p.layer} · Combat (${p.encounterType})`];
    if (p.intel?.types) parts.push(`enemies: ${p.intel.types.join(", ")}`);
    else parts.push("enemies: unknown");
    if (p.intel?.count !== undefined) parts.push(`count: ${p.intel.count}`);
    if (p.intel?.grantsVision) parts.push("starting vision");
    parts.push(`reward: ${p.rewardHint ?? "unknown"}`);
    return parts.join("   ·   ") + road;
  }

  private clearMap(): void {
    clearLayer(this.nodeObjects);
    this.graph?.destroy();
    this.graph = undefined;
    this.previewText.setText("");
  }

  // --- The unified overworld camp (D35) -------------------------------------

  /**
   * Open the unified camp at a chosen node: advance the run there, then surface the
   * overworld actions (cooldown- + fatigue-gated) and meta/provision actions before
   * the player commits onward. This is the single between-nodes surface (D35).
   */
  private enterCamp(node: MapNode): void {
    this.clearMap();
    // D80 night-after-arrival: the nightly rest fires *inside* loop.choose (on arrival). Snapshot
    // the party across it so the prep camp can recap what the night restored.
    const before = this.run.party.map((u) => ({ id: u.id, name: u.name, hp: u.hp, fatigue: u.fatigue }));
    this.loop.choose(node.id);
    this.arrivalRecap = this.buildArrivalRecap(before, node);
    this.campNode = node;
    // D80 the arrival layer: a light early event may fire on the road before the prep camp.
    const early = earlyEventForNode(this.run, node);
    if (early) this.playEarlyEvent(node, early);
    else this.renderCamp();
  }

  /**
   * An **early event** on the road (D80) — the arrival layer, before the prep camp. An **interactive**
   * (tailored) event offers a choice — e.g. a gated encounter-bypass; the **auto-resolving** random
   * pool (pickpocket / patron) just applies and reports.
   */
  private playEarlyEvent(node: MapNode, def: EventDef): void {
    const choices = def.choices?.(this.run, node) ?? [];
    if (choices.length > 0) {
      this.renderEarlyChoicePanel(node, def, choices);
      return;
    }
    const outcome = resolveEarlyEvent(this.run, node, def);
    // Colour the overlay by the swing: a windfall/patron reads good, a skim reads as a loss.
    const good = (outcome.goldDelta ?? 0) >= 0 && def.standingBias !== "bane";
    this.showOverlay(`On the road — ${def.name}`, outcome.summary, good, 520, 200, () => this.renderCamp());
  }

  /**
   * A **tailored** early event's choice panel (D80) — e.g. The Blockade: buy passage (a gated
   * bypass) or cut through. Taking a **bypass** short-circuits the encounter (RunLoop.bypassEncounter:
   * keep HP + EXP, forgo loot) and returns to the react camp; any other choice proceeds to the prep
   * camp and the normal fight.
   */
  private renderEarlyChoicePanel(node: MapNode, def: EventDef, choices: EventChoice[]): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 20;
    const w = 560;
    const h = 130 + choices.length * 40;

    clearLayer(this.overlay);
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.96).setStrokeStyle(2, COLOR.info).setDepth(20),
      this.add.text(cx, cy - h / 2 + 24, `On the road — ${def.name}`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(cx, cy - h / 2 + 58, `${def.teaser}\nPurse ${this.run.camp.gold}g`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body, align: "center", lineSpacing: 4, wordWrap: { width: w - 60 } }).setOrigin(0.5).setDepth(21),
    );

    let y = cy - h / 2 + 110;
    for (const choice of choices) {
      const enabled = choice.available;
      const fill = enabled ? COLOR.btnFill : COLOR.surfaceRaised;
      const stroke = enabled ? COLOR.info : COLOR.border;
      const btn = this.makeTextButton(cx, y, 380, 30, choice.label, fill, stroke, () => {
        if (enabled) this.onEarlyChoice(node, def, choice);
      });
      if (choice.detail) btn.bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.setHint(choice.detail!));
      this.overlay.push(btn);
      y += 40;
    }
  }

  /** Apply a tailored early-event choice: a bypass short-circuits to the react camp; otherwise fight on. */
  private onEarlyChoice(node: MapNode, def: EventDef, choice: EventChoice): void {
    const out: EventOutcome = def.choose!(this.run, node, choice.id);
    this.refreshCampText();
    clearLayer(this.overlay);
    if (out.bypass) {
      const res = this.loop.bypassEncounter();
      const lines = [out.summary, "", `Each fighter keeps ${res.xpEach} EXP — the plunder's forgone.`, `Purse now ${this.run.camp.gold}g.`];
      this.showOverlay(`On the road — ${def.name}`, lines.join("\n"), true, 540, 230, () => this.afterNode());
    } else {
      // Declined the bypass — the encounter stands; drop into the prep camp and Begin as normal.
      this.renderCamp();
    }
  }

  /**
   * The prep camp's "last night's rest" recap (D80) — one line per unit the arrival rest touched
   * (HP chipped back, a fatigue tier shed). A Clearing skips the arrival rest (its Deep Rest lands
   * when you Begin), so it reads its own note instead.
   */
  private buildArrivalRecap(before: { id: string; name: string; hp: number; fatigue: number }[], node: MapNode): string[] {
    if (node.kind === "rest") return ["A Clearing — the Deep Rest comes when you Begin."];
    const lines: string[] = [];
    for (const b of before) {
      const now = this.run.party.find((u) => u.id === b.id);
      if (!now) continue;
      const parts: string[] = [];
      if (now.hp > b.hp) parts.push(`+${now.hp - b.hp} HP`);
      const fromTier = fatigueTier(b.fatigue);
      const toTier = fatigueTier(now.fatigue);
      if (fromTier !== toTier) parts.push(`${fromTier} → ${toTier}`);
      if (parts.length) lines.push(`${b.name}  ${parts.join(" · ")}`);
    }
    return lines.length ? lines : ["The party arrived rested — nothing to shed."];
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
    // The PREP camp (D80): arrival's night is done — this beat is rest-recap + gear-up, ending in
    // **Begin**. Its identity is the warm campfire (ember), paired against the react beat's gold.
    this.titleText.setText(`Prep — Night ${this.run.night + 1} · ${kindLabel}`);
    this.setHint("Prep camp: the night's rest is done — gear up, provision, heal, then Begin.");

    const cx = this.scale.width / 2;
    const panelW = this.scale.width - 40; //  ~760 — nearly full width
    const panelTop = 60;
    const panelBottom = this.scale.height - 16; // ~584 — nearly full height
    const top = 84;
    const colX = cx - panelW / 2 + 30;
    const rowH = 30;
    const readoutCardW = 200;
    const readoutX = cx + panelW / 2 - 30 - readoutCardW;

    // The live figures move off the static top line into a right-side state panel
    // (below) — hide the header line so the caravan's state reads in one place.
    this.campText.setVisible(false);

    // The "last night's rest" recap band (ember) — what the arrival rest restored (D80).
    const recapBottom = this.renderPrepRecap(colX, top, panelW);

    // --- Areas toolbar (D58): the "different areas" ---------------------------
    // A compact top row of deep-links to the *places you go* (the Tent / Stores / Ledger /
    // Map pages, the Market), kept above the left column's *actions you take here* so the two
    // purposes read distinctly — and the same nav renders atop each of those pages.
    const areasBottom = this.renderAreaNav("camp", () => this.renderCamp(), this.campObjects, colX, recapBottom + 6);
    const bodyTop = areasBottom + 20;

    // --- The action drawers (left) + the live state readouts (right) ----------
    // The readout tiles (34px) are taller than the drawer buttons (24px), and both centre on
    // the row they're given — so at a shared top the taller tile overhangs. Nudge the readouts
    // down by half the height difference (5px) so the first tile's top sits level with the
    // Recovery button's top.
    const actionsBottom = this.renderCampActions(colX, bodyTop, rowH);
    this.renderReadouts(readoutX, bodyTop + 5, readoutCardW);

    // The captain's running to-do sits below the actions, kept clear of the readouts.
    this.renderCaptainsJournal(colX, actionsBottom + 12, readoutX - 16 - colX);

    // --- Begin — the prep beat's advance verb (D80); anchored to the panel's bottom ---
    // Starts the node's main event: a combat/event encounter, or — at a Clearing — its Deep Rest.
    // The node's kind (shown in the title) is what Begin then faces.
    const commit = this.makeTextButton(cx, panelBottom - 30, 260, 34, "Begin", COLOR.successDeep, COLOR.success, () => this.commit());
    this.campObjects.push(commit);

    // A near-full-screen box so the camp doesn't read as cramped: content sits at the top,
    // the turn-close primary anchors the bottom. Added last; its low depth keeps it behind.
    this.campObjects.push(
      this.add.rectangle(cx, (panelTop + panelBottom) / 2, panelW, panelBottom - panelTop, COLOR.surface, 0.96).setStrokeStyle(2, COLOR.border).setDepth(8),
    );
  }

  /**
   * The prep camp's **"last night's rest" recap band** (D80) — an ember accent rule + one line per
   * unit the arrival rest restored (or a Clearing's Deep-Rest note). The warm campfire counterpart
   * to the react camp's gold route-forecast band. Returns the y-bottom for laying out below it.
   */
  private renderPrepRecap(x: number, y: number, panelW: number): number {
    this.campObjects.push(
      // The ember rule — the prep beat's campfire identity.
      this.add.rectangle(x - 10, y - 8, 64, 3, COLOR.accent, 0.9).setOrigin(0, 0.5).setDepth(11),
      this.add.text(x - 10, y + 6, "The night's rest", { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
    );
    const shown = this.arrivalRecap.slice(0, 4);
    const extra = this.arrivalRecap.length - shown.length;
    const body = extra > 0 ? [...shown, `…and ${extra} more`] : shown;
    this.campObjects.push(
      this.add.text(x - 10, y + 20, body.join("\n"), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 4, wordWrap: { width: panelW - 60 } }).setOrigin(0, 0).setDepth(11),
    );
    return y + 20 + body.length * 16 + 4;
  }

  /**
   * The right-hand **areas** column (D58): one-click deep-links to the Captain's Tent
   * tabs (Party / Stores / Ledger) and the route map — the *places you go*, kept on the
   * right and apart from the left column's *actions you take here*, so the two purposes
   * don't blur. Shared by both camp beats; `rerender` is the beat to return to on close.
   * Returns the y-centre of the last link (for sizing the content below it).
   */
  /**
   * The **areas nav** (D58) — the one consistent navigation for the between-nodes surface: a
   * compact tab row pinned to the **upper left**, with **Camp** as a peer tab alongside the
   * Tent / Stores / Ledger / Map pages. The very same row renders on the camp/survey beats
   * (`active === "camp"`) and atop each page (with the open tab highlighted), so the nav never
   * shifts between views and Camp is always one click away. Market is a trailing entry, present
   * only with market access (a shop overlay, not one of the pages). Buttons draw onto `layer`
   * (camp beats → `campObjects`; pages → `overlay`). Returns the `y` just past the row.
   */
  private renderAreaNav(active: TentTab | "camp", returnTo: () => void, layer: Phaser.GameObjects.GameObject[], x: number, y: number): number {
    // Camp leads the row: on a page it returns to the between-nodes beat; on the beat itself
    // it's the active tab (a harmless re-render). `returnTo` *is* the beat, so both go through it.
    const toCamp = active === "camp" ? returnTo : () => this.closeTent();
    const entries: { id: TentTab | "camp" | "market"; label: string; onClick: () => void; tip: string }[] = [
      { id: "camp", label: "Camp", onClick: toCamp, tip: "The between-nodes camp — provision, heal, gear up, then Begin (or Set Out from the react beat)." },
      { id: "party", label: this.tentToolbarLabel(), onClick: () => this.openTent(returnTo, "party"), tip: "The Captain's Tent — the Party dossier (HP, fatigue, conditions, jeopardy, growth). ⚠ marks anyone hurt, dying or captured." },
      { id: "stores", label: "Stores", onClick: () => this.openTent(returnTo, "stores"), tip: "Caravan stores — carried gear and consumables with the space each takes, storage cap, and the purse." },
      { id: "ledger", label: "Ledger", onClick: () => this.openTent(returnTo, "ledger"), tip: "Gold flow (realized + projected) and the route forecast; cross Upkeep lines off here." },
      { id: "map", label: "Map", onClick: () => this.openTent(returnTo, "map"), tip: "The overworld node map (read-only) — route, reachable nodes, and fog." },
    ];
    // Market — a *place you visit*, listed only when you have access (a market node or a
    // Merchant in the party). Hidden otherwise, so trap-kit/herb restock is a real logistics
    // gate. It's a shop overlay, not a page, so it never carries an `active` highlight.
    if (effectiveMarketTier(this.campNode ?? currentNode(this.run), this.run.party) !== "none") {
      entries.push({ id: "market", label: "Market", onClick: () => this.openMarket(returnTo), tip: "Buy supplies (trap kits, herbs) and sell salvage. Only open with market access. Stock up: you may not pass a market again soon." });
    }
    const h = 26;
    const gap = 8;
    let bx = x;
    for (const e of entries) {
      const bw = this.measureButtonWidth(e.label);
      this.navButton(bx, y, bw, h, e.label, e.id === active, e.onClick, e.tip, layer);
      bx += bw + gap;
    }
    return y + h / 2;
  }

  /** One areas-nav button — a left-anchored tab with an active (gold) highlight, a hover
   *  hint, drawn onto the given `layer` so the nav can live on the camp or the page. */
  private navButton(x: number, y: number, w: number, h: number, text: string, active: boolean, onClick: () => void, description: string, layer: Phaser.GameObjects.GameObject[]): void {
    const bg = this.add.rectangle(x, y, w, h, active ? COLOR.btnFill : COLOR.surfaceAlt).setStrokeStyle(1, active ? COLOR.gold : COLOR.borderSoft).setOrigin(0, 0.5).setDepth(25).setInteractive({ useHandCursor: true });
    const label = this.add.text(x + 10, y, text, { color: active ? INK.gold : INK.bright, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(26);
    fitText(label, w - 16);
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.hintPanel.setText(description));
    layer.push(bg, label);
  }

  /** Compact toolbar variant of the tent label — "Tent" (+ a ⚠ attention badge). */
  private tentToolbarLabel(): string {
    const n = attentionCount(projectDossier(this.run));
    return n > 0 ? `Tent  ⚠${n}` : "Tent";
  }

  /** Width for a compact toolbar button sized to fit its label (measured + side padding). */
  private measureButtonWidth(label: string): number {
    const probe = this.add.text(0, 0, label, { fontFamily: FONT.family, fontSize: FONT.label }).setVisible(false);
    const w = Math.ceil(probe.width) + 24;
    probe.destroy();
    return w;
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
          ? `${skill.name} — ${skill.description} (${left} use${left === 1 ? "" : "s"} left tonight; resets when you Set Out.)`
          : `${skill.name} — ${skill.description}`;
        out.push({ label: `${skill.name} · ${u.name}${usesTag}`, enabled: left > 0, onClick: () => this.useCampSkill(u, skill), tip, preview: skillEffectPreview(skill, this.run), name: skill.name, actor: u.name, costs: this.actionCost(skill) });
      }
    }
    const healer = this.triageActor();
    if (healer) {
      const someoneWounded = combatRoster(this.run).some((u) => u.hp < u.maxHp);
      const tip = someoneWounded
        ? `${healer.name} (healer) spends fatigue to mend the most-wounded fighter — more the worse the wound. Pure stamina, no Rest Points; a worn-out healer must rest first.`
        : "No wounded fighter to triage.";
      out.push({ label: `Triage · ${healer.name} (fatigue)`, enabled: someoneWounded, onClick: () => this.doTriage(healer), tip, preview: triageActionPreview(), name: "Triage", actor: healer.name, costs: { fatigue: TRIAGE.fatigue } });
    }
    return out;
  }

  /** Structured cost of an overworld skill — the component slots (gold / fatigue / cooldown). */
  private actionCost(skill: SkillDef): ActionCost {
    const cost = overworldCostOf(skill);
    const gold = resolveKnob(cost.gold, this.run);
    const cd = cooldownRemaining(this.run.overworld, skill.id);
    return {
      gold: gold > 0 ? gold : undefined,
      fatigue: (cost.fatigue ?? 0) > 0 ? cost.fatigue : undefined,
      cooldown: cd > 0 ? cd : undefined,
    };
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
      this.campButton(childX, y, childW, 24, `Invest the Purse · ${banker.name}`, true, () => this.bankerInterest(), "Banker: the carried purse accrues flat interest each node-step. Purse only — never the treasury.", bankerInterestPreview(this.run));
      y += rowH;
      this.campButton(childX, y, childW, 24, `Borrow 40g · ${banker.name}`, true, () => this.bankerBorrow40(), "Banker: overspend now; auto-repaid from incoming run gold.", bankerBorrowPreview(40));
      y += rowH;
      const protCost = ECONOMY.banker.protectionCost;
      this.campButton(childX, y, childW, 24, `Guard the Purse (${protCost}g) · ${banker.name}`, this.run.camp.gold >= protCost, () => this.bankerProtect(), "Banker: blunt a thief's skim — battle thief and event node alike.", bankerProtectPreview());
      y += rowH;
    }
    // The Noble's Patronize (D62) — gold → Influence, once per node; tagged with the Noble.
    if (noble) {
      const patronCost = ECONOMY.noble.patronizeCost;
      const patronTip = `Noble: court patrons — spend ${patronCost}g for +${ECONOMY.noble.patronizeYield} Influence (once per node). A Noble also earns Influence passively as you travel. Influence never pays Upkeep; it sways enemies mid-battle.`;
      this.campButton(childX, y, childW, 24, `Patronize (${patronCost}g → +${ECONOMY.noble.patronizeYield} Influence) · ${noble.name}`, this.run.camp.gold >= patronCost, () => this.patronize(), patronTip, patronizePreview());
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
        // The card-row prototype: a structured action (with a `name`) renders as a cost-bearing
        // card; the rest stay simple buttons until the new grammar is proven and rolled out.
        if (a.name) this.renderActionCard(colX + 14, y, 346, 26, a);
        else this.campButton(colX + 14, y, 346, 24, a.label, a.enabled, a.onClick, a.tip, a.preview);
        y += rowH;
      }
    }
    return y;
  }

  /**
   * The caravan's live **state readouts** (D58) — Purse / Morale / Storage / Kits / RP /
   * Upkeep as a vertical stack of value tiles, drawn to the right of the action column so
   * the figures read as live gauges of the caravan's state rather than a static header
   * line. Each tile pairs a muted label with a semantically-coloured, prominent value
   * (purse gold, morale by tier, storage ember when full, upkeep as a warm drain). Pure
   * figures come from {@link "../../core".campReadout}. Returns the `y` past the stack.
   */
  private renderReadouts(x: number, top: number, cardW: number): number {
    const r = campReadout(this.run);

    // Anchor the "this day" comparison to the node we're camped at: the baseline is the
    // figures on arrival, so a value's colour tracks its **net move since we made camp
    // here**. A fresh node (or a fresh scene, e.g. back from battle) re-baselines and
    // suppresses the change-pulse for that first paint.
    const nodeKey = this.run.mapNodeId;
    const fresh = this.readoutBaselineKey !== nodeKey;
    if (fresh) {
      this.readoutBaseline = r;
      this.readoutBaselineKey = nodeKey;
      this.readoutLast = r;
    }
    const base = this.readoutBaseline!;
    const last = this.readoutLast!;

    const moraleInk = r.moraleTier === "Low" ? INK.ember : r.moraleTier === "Neutral" ? INK.secondary : INK.success;
    // `betterHigher` gives each value a *sense* — so a rising purse reads good (green) but a
    // rising Upkeep reads bad (red). Storage carries no valence (loot vs. headroom cut both
    // ways), so it keeps its semantic ink and never day-colours. `ink` is the unchanged look.
    type Tile = { stat: ReadoutStat; label: string; value: string; ink: string; cur: number; base: number; last: number; betterHigher?: boolean };
    const tiles: Tile[] = [
      { stat: "purse", label: "Purse", value: `${r.purse}g`, ink: INK.gold, cur: r.purse, base: base.purse, last: last.purse, betterHigher: true },
      { stat: "morale", label: "Morale", value: `${r.moraleTier} (${r.morale >= 0 ? "+" : ""}${r.morale})`, ink: moraleInk, cur: r.morale, base: base.morale, last: last.morale, betterHigher: true },
      { stat: "storage", label: "Storage", value: `${r.storageUsed}/${r.storageCap}`, ink: r.storageUsed >= r.storageCap ? INK.ember : INK.secondary, cur: r.storageUsed, base: base.storageUsed, last: last.storageUsed },
      { stat: "kits", label: "Trap Kits", value: `${r.kits}`, ink: r.kits > 0 ? INK.secondary : INK.disabled, cur: r.kits, base: base.kits, last: last.kits, betterHigher: true },
      { stat: "rp", label: "Rest Pts", value: `${r.rp}`, ink: INK.secondary, cur: r.rp, base: base.rp, last: last.rp, betterHigher: true },
      { stat: "upkeep", label: "Upkeep", value: `${r.upkeep}g/night`, ink: INK.ember, cur: r.upkeep, base: base.upkeep, last: last.upkeep, betterHigher: false },
    ];
    const cardH = 34;
    const pitch = 42;
    const tileCy: Partial<Record<ReadoutStat, number>> = {};
    tiles.forEach((t, i) => {
      const cy = top + i * pitch;
      tileCy[t.stat] = cy;
      // Day-move colour: green when the value improved since we made camp, red when it
      // worsened — otherwise the tile's unchanged semantic ink.
      let ink = t.ink;
      if (t.betterHigher !== undefined && t.cur !== t.base) {
        ink = (t.cur > t.base) === t.betterHigher ? INK.success : INK.danger;
      }
      const rect = this.add.rectangle(x, cy, cardW, cardH, COLOR.surfaceRaised).setStrokeStyle(1, COLOR.borderSoft).setOrigin(0, 0.5).setDepth(10);
      const label = this.add.text(x + 12, cy, t.label.toUpperCase(), { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11);
      // 14px (one above the 13px body label) — the value stays the figure without towering
      // over its label the way the old 16px heading did. Deliberately between body/heading.
      const value = this.add.text(x + cardW - 12, cy, t.value, { color: ink, fontFamily: FONT.family, fontSize: "14px" }).setOrigin(1, 0.5).setDepth(11);
      this.campObjects.push(rect, label, value);
      // Pulse a tile the instant its figure changes from the previous paint (an action's
      // effect landing) — but not on the first paint of a camp (`fresh`), which isn't a move.
      if (!fresh && t.cur !== t.last && !isScreenshotMode()) this.pulseTile(x, cy, cardW, cardH, value);
    });
    this.readoutLast = r;

    // The off-panel preview area, below the tiles: a header + a rule, then the transient
    // body ({@link showActionPreview}) — arrows land in the gutter beside the tiles above,
    // off-panel effects (HP/Fatigue/Influence/…) list here. Reserve it so hover has a home.
    const tilesBottom = top + (tiles.length - 1) * pitch + cardH / 2;
    const areaTop = tilesBottom + 14;
    this.campObjects.push(this.add.text(x, areaTop, "EFFECT PREVIEW", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(11));
    const rule = this.add.graphics().setDepth(11);
    rule.lineStyle(1, COLOR.borderSoft, 0.7);
    rule.lineBetween(x, areaTop + 12, x + cardW, areaTop + 12);
    this.campObjects.push(rule);
    this.readoutGeom = { x, cardW, tileCy, areaX: x, areaW: cardW, areaTop: areaTop + 12 };
    this.showActionPreview(null);

    return tilesBottom;
  }

  /**
   * Paint the hover preview for one action (or clear it, `preview === null`, to the resting
   * "hover an action" prompt). Panel changes draw a signed arrow in the gutter *left of*
   * their readout tile; off-panel changes (HP, Fatigue, Influence, Debt, …) list in the
   * preview area below the tiles. Lives on its own {@link previewObjects} layer so a
   * hover-out redraws just this, never the whole camp. Colour follows each change's `good`.
   */
  private showActionPreview(preview: ActionPreview | null): void {
    clearLayer(this.previewObjects);
    const g = this.readoutGeom;
    if (!g) return;
    if (!preview || preview.length === 0) {
      this.previewObjects.push(this.add.text(g.areaX, g.areaTop + 14, "Hover an action to preview its effect.", { color: INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption, lineSpacing: 3, wordWrap: { width: g.areaW } }).setOrigin(0, 0).setDepth(13));
      return;
    }
    const disp = (c: PreviewChange): { text: string; ink: string } => {
      const good = c.good ?? (c.amount ?? 0) >= 0;
      const arrow = c.amount === undefined ? "" : c.amount >= 0 ? "▲" : "▼";
      const text = c.text ?? `${c.amount! >= 0 ? "+" : ""}${c.amount}`;
      return { text: `${arrow}${arrow ? " " : ""}${text}`, ink: good ? INK.success : INK.danger };
    };
    // Panel changes → an arrow in the gutter beside the matching tile.
    for (const c of preview) {
      if (!c.stat) continue;
      const cy = g.tileCy[c.stat];
      if (cy === undefined) continue;
      const d = disp(c);
      this.previewObjects.push(this.add.text(g.x - 12, cy, d.text, { color: d.ink, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(13));
    }
    // Off-panel changes → the reserved area below the tiles.
    const off = preview.filter((c) => !c.stat);
    if (off.length === 0) {
      this.previewObjects.push(this.add.text(g.areaX, g.areaTop + 14, "No off-panel effects.", { color: INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0).setDepth(13));
      return;
    }
    let ay = g.areaTop + 20;
    for (const c of off) {
      const d = disp(c);
      this.previewObjects.push(
        this.add.text(g.areaX, ay, c.label, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(13),
        this.add.text(g.areaX + g.areaW, ay, d.text, { color: d.ink, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(13),
      );
      ay += 20;
    }
  }

  /** A one-shot attention pulse on a just-changed readout tile: a quick value bump + a
   *  fading firelight glow. Tweens are tracked so {@link clearCamp} can tear them down. */
  private pulseTile(x: number, cy: number, cardW: number, cardH: number, value: Phaser.GameObjects.Text): void {
    value.setScale(1.4);
    this.readoutTweens.push(this.tweens.add({ targets: value, scale: 1, duration: 360, ease: "Back.out" }));
    // A translucent glow over the tile (no numeric colour-tween — that would lerp to muddy
    // in-between hues), faded to nothing so the eye catches the change then settles.
    const glow = this.add.rectangle(x, cy, cardW, cardH, COLOR.accent, 0.3).setOrigin(0, 0.5).setDepth(12);
    this.campObjects.push(glow);
    this.readoutTweens.push(this.tweens.add({ targets: glow, alpha: 0, duration: 460, ease: "Cubic.out" }));
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
    const cdStr = cd > 0 ? `${cd} night${cd === 1 ? "" : "s"}` : "ready";
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
    if (cd > 0) return `On cooldown — ${cd} more night${cd === 1 ? "" : "s"}.`;
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

  /**
   * Open the party dossier (D-info-surfacing). **Page mode:** launch the dossier on
   * top and pause this scene, so the camp panel is preserved exactly and restored on
   * close (a clean seam for the future live-overlay mode — launch the same scene
   * without pausing). The dossier reads the live run, so its numbers are current.
   */
  // --- The Captain's Tent (D58): the one deep-info hub ------------------------

  /**
   * Open a Captain's Tent **page** — the run's deep-info hub, now a full-view page (not a
   * dimmed overlay). Party / Stores / Ledger / Map are peer pages sharing one nav tab row
   * pinned upper-left ({@link renderAreaNav}); `returnTo` is the between-nodes beat the
   * **Camp →** return restores. Converges what were three scattered surfaces — the dossier
   * scene, the inventory panel and its nested ledger — plus the route map, under one nav.
   */
  private openTent(returnTo: () => void, tab: TentTab = "party"): void {
    this.tentReturn = returnTo;
    this.tentTab = tab;
    this.renderTent();
  }

  /** Tear down the current Tent page and hand control back to the beat that opened it. */
  private closeTent(): void {
    this.tentDossier?.destroy();
    this.tentDossier = undefined;
    clearLayer(this.overlay);
    this.clearMap(); // the Map page draws the board on its own layer — clear it on the way out
    const back = this.tentReturn;
    this.tentReturn = null;
    back?.();
  }

  /**
   * (Re)draw the active Tent page: the shared upper-left nav, then the page body. Party /
   * Stores / Ledger render as a framed panel; Map fills the view with the read-only board.
   * A full-view page (camp cleared behind it), so the nav is the whole navigation.
   */
  private renderTent(): void {
    this.tentDossier?.destroy();
    this.tentDossier = undefined;
    this.clearCamp();
    this.clearMap();
    clearLayer(this.overlay);

    const cx = this.scale.width / 2;
    const panelW = this.scale.width - 40;
    const colX = cx - panelW / 2 + 30;
    const navY = 84;
    const returnTo = this.tentReturn ?? (() => this.renderCamp());

    if (this.tentTab === "map") {
      // Map page: the read-only board fills the view; the shared nav floats over it.
      this.drawMap(false);
      this.titleText.setText(`Route Map — Night ${this.run.night + 1} · reviewing`);
      this.renderAreaNav("map", returnTo, this.overlay, colX, navY);
      this.setHint("Route Map — hover a node to preview it. Switch pages above, or return to Camp (Esc).");
      this.input.keyboard?.once("keydown-ESC", () => this.closeTent());
      return;
    }

    // Panel pages (Party / Stores / Ledger): a near-full-screen page, nav pinned upper-left.
    this.campText.setVisible(false);
    const panelTop = 60;
    const panelBottom = this.scale.height - 16;
    this.overlay.push(
      this.add.rectangle(cx, (panelTop + panelBottom) / 2, panelW, panelBottom - panelTop, COLOR.surface, 0.98).setStrokeStyle(2, COLOR.border).setDepth(22),
    );
    this.titleText.setText(`Captain's Tent — Night ${this.run.night + 1}`);
    const navBottom = this.renderAreaNav(this.tentTab, returnTo, this.overlay, colX, navY);

    const contentTop = navBottom + 14;
    const bounds = new Phaser.Geom.Rectangle(colX - 8, contentTop, panelW - 44, panelBottom - 16 - contentTop);
    if (this.tentTab === "party") this.drawTentParty(bounds);
    else if (this.tentTab === "stores") this.drawTentStores(bounds);
    else this.drawTentLedger(bounds);

    this.setHint("Captain's Tent — switch pages above, or return to Camp (Esc).");
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
    // Party headcount belongs to the Tent's Party tab, not the stores sheet — this line is
    // pure logistics (vessel + storage), so it stays about the cargo, not the roster.
    const vessel = m.vesselLabel ? `${m.vesselLabel} · ` : "";
    const g = this.add.graphics().setDepth(24);
    this.overlay.push(
      g,
      this.add.text(leftX, b.top + 12, `${vessel}Storage ${m.storageUsed}/${m.storageCap} (free ${m.storageFree})`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
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
    // Stores lists only what we actually carry — a group with nothing in it (and the
    // "what could we still stock" catalog of zero-count materials) belongs to the Market,
    // not here. The projection still reports every known material; we filter for display.
    let anyCarried = false;
    for (const grp of m.groups) {
      const carried = grp.items.filter((it) => it.count > 0);
      if (carried.length === 0) continue;
      anyCarried = true;
      this.overlay.push(this.add.text(leftX, y, grp.title, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
      y += rowH;
      for (const it of carried) {
        // Quantity rides next to the name (×N), shown only when we hold more than one — a
        // lone item needs no count. The right column carries the storage footprint (Space: N).
        const qty = it.count > 1 ? `  ×${it.count}` : "";
        this.overlay.push(
          this.add.text(leftX + 8, y, `${it.name}${qty}`, { color: INK.bright, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
          this.add.text(leftX + 160, y, `${it.effect} · ${it.recoverable ? "recoverable" : "consumed"}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(25),
          this.add.text(rightX, y, it.slots > 0 ? `Space: ${it.slots}` : "", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
        );
        y += rowH;
      }
    }
    if (!anyCarried) {
      this.overlay.push(this.add.text(leftX, y, "Stores are empty — nothing carried yet.", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25));
    }
  }

  /** Ledger page — gold flow (realized + projected) + the route forecast (D45/D48). Market
   *  access lives in the shared nav's Market tab now, so no in-page shortcut is needed. */
  private drawTentLedger(b: Phaser.Geom.Rectangle): void {
    this.drawLedgerSheet(b, { rerender: () => this.renderTent() });
  }

  /**
   * The ledger sheet itself (D45/D48) — Balance/Influence header, the category rows,
   * and the route forecast — drawn into `b`. Shared by the Captain's Tent ledger tab
   * and the night-end {@link showLedgerTransition}; returns the built {@link Ledger}
   * so the caller can add its own chrome (the Tent's Market shortcut). `rerender`
   * fires after an Upkeep line is crossed off so the owning surface redraws itself;
   * `interactive: false` makes the sheet read-only (the rest tiers force-pay Upkeep).
   */
  private drawLedgerSheet(b: Phaser.Geom.Rectangle, opts: { rerender: () => void; interactive?: boolean }): Ledger {
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

    let y = this.drawLedgerRows(ledger, g, { leftX, rightX, colX, rowH, cx: b.centerX, pad, w: b.width }, b.top + 26 + 18, opts);
    // Forecasted balance — the estimated purse carried into tomorrow (current balance after
    // tonight's projected Upkeep/Banker). A bottom-line bookend to the top Balance; a rule
    // sets it apart from the category rows.
    y += 4;
    g.lineStyle(1, COLOR.borderSoft, 0.9);
    g.lineBetween(leftX, y, rightX, y);
    y += 14;
    this.overlay.push(
      this.add.text(leftX, y, "Forecasted balance  · into tomorrow", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
      this.add.text(rightX, y, `${ledger.forecastBalance}g`, { color: ledger.forecastBalance < 0 ? INK.danger : INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(1, 0.5).setDepth(25),
    );
    // The route forecast (runway + per-edge) is planning, not accounting — it lives on the
    // Survey panel, so the ledger stops at its own bottom line.
    return ledger;
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
    // Storage on the header so the space you're spending is visible while you shop — buys eat
    // slots (see each row's Space) and a full stash blocks them, so surface the cap up front.
    const invUsed = slotsUsed(this.run.inventory);
    this.overlay.push(this.add.text(left + w - 24, top + 52, `Storage ${invUsed}/${this.run.inventory.storageCap} (free ${this.run.inventory.storageCap - invUsed})`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25));

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
        // Space this purchase will add (stacks pack, so buying into a partial stack can add 0) —
        // the "how much room am I about to spend" readout, live with the stepper.
        const addSlots = slotsFor(mat, owned + qty) - slotsFor(mat, owned);
        this.overlay.push(this.add.text(leftX + 200, y, `Space: +${addSlots}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(25));
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
  private campButton(x: number, y: number, w: number, h: number, text: string, enabled: boolean, onClick: () => void, description: string, preview?: ActionPreview): void {
    const fill = enabled ? COLOR.surfaceAlt : COLOR.surfaceRaised;
    const bg = this.add.rectangle(x, y, w, h, fill).setStrokeStyle(1, enabled ? COLOR.borderSoft : COLOR.surfaceAlt).setOrigin(0, 0.5).setDepth(10);
    const label = this.add.text(x + 8, y, text, { color: enabled ? INK.bright : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(11);
    fitText(label, w - 16);
    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
    }
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.hintPanel.setText(description));
    // Preview the action's effect on the readout panel while hovered (even when greyed —
    // seeing *what it would do* explains the grey), snapping back to the resting prompt out.
    if (preview) {
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.showActionPreview(preview));
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.showActionPreview(null));
    }
    this.campObjects.push(bg, label);
  }

  /**
   * A **cost-bearing action card** (the readout-tile grammar applied to a verb, prototype): the
   * action **name** (bright) + **actor** (muted) on the left, its compact **cost** right-aligned
   * and coloured by kind — so a row answers "what does this cost and who does it" at a glance, the
   * way the state tiles answer "what is this figure". Hover still drives the richer EFFECT PREVIEW.
   */
  private renderActionCard(x: number, y: number, w: number, h: number, a: CampAction): void {
    const enabled = a.enabled;
    const bg = this.add.rectangle(x, y, w, h, COLOR.surfaceRaised, enabled ? 1 : 0.5).setStrokeStyle(1, enabled ? COLOR.borderSoft : COLOR.border).setOrigin(0, 0.5).setDepth(10);
    const name = this.add.text(x + 12, y, a.name ?? a.label, { color: enabled ? INK.bright : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(11);
    this.campObjects.push(bg, name);
    if (a.actor) {
      this.campObjects.push(this.add.text(x + 12 + Math.ceil(name.width) + 8, y, a.actor, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(11));
    }
    this.renderCostChips(x + w - 12, y, a.costs, enabled);
    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, a.onClick);
    }
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.hintPanel.setText(a.tip));
    if (a.preview) {
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.showActionPreview(a.preview!));
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.showActionPreview(null));
    }
  }

  /**
   * The **cost components** of an action row (prototype): each present cost type renders as an
   * `icon N` chip in the fixed {@link COST_COMPONENTS} order, coloured by type, and the group is
   * right-anchored at `rightX` so costs read the same way down the column. No cost reads "free".
   */
  private renderCostChips(rightX: number, y: number, costs: ActionCost | undefined, enabled: boolean): void {
    const present = COST_COMPONENTS.filter((c) => costs?.[c.key] != null);
    if (present.length === 0) {
      this.campObjects.push(this.add.text(rightX, y, "free", { color: enabled ? INK.muted : INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(1, 0.5).setDepth(11));
      return;
    }
    const gap = 12;
    const chips = present.map((c) => {
      const v = costs![c.key]!;
      const n = c.key === "material" ? (v as { n: number }).n : (v as number);
      return this.add.text(0, y, `${c.glyph} ${n}`, { color: enabled ? c.ink : INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(11);
    });
    const widths = chips.map((t) => Math.ceil(t.width));
    const total = widths.reduce((s, w) => s + w, 0) + gap * (chips.length - 1);
    let cx = rightX - total;
    chips.forEach((t, i) => {
      t.x = cx;
      cx += widths[i] + gap;
      this.campObjects.push(t);
    });
  }

  private clearCamp(): void {
    // Stop any in-flight readout pulses before their tiles are destroyed below.
    this.readoutTweens.forEach((t) => t.remove());
    this.readoutTweens = [];
    clearLayer(this.previewObjects);
    this.readoutGeom = undefined;
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
    // A rest node elapses a night and pays a night's rations — show the spend first.
    this.showLedgerTransition("Before resting for the night…", () => {
      const res = this.loop.restNode();
      this.refreshCampText();
      this.showRestScreen(res);
    });
  }

  private showRestScreen(res: RestResult): void {
    const lines: string[] = [];
    const upkeepNote = res.upkeep.underfunded.length > 0 ? `Underfunded ${res.upkeep.underfunded.join(" + ")} — morale took a hit.` : `Upkeep paid (${res.upkeep.paid}g).`;
    lines.push(upkeepNote);
    lines.push(`Banked +${res.rpAdded} Rest Points; morale +${res.moraleGained}.`);
    if (res.healed.length) lines.push(`Deep rest: ${res.healed.map((h) => `${h.unitId} +${h.hp} HP`).join(", ")}.`);
    else if (!res.chipHealed.length) lines.push("No one needed mending — the party rested easy.");
    // The Tier-0 gate made legible (D80): the too-worn rested off their fatigue, not their wounds.
    if (res.chipHealed.length) lines.push(`Too worn for a full recovery — ${res.chipHealed.map((h) => `${h.unitId} +${h.hp} HP`).join(", ")} (rested off fatigue only).`);
    if (res.fatigueRestored.length) lines.push(`Fatigue restored: ${res.fatigueRestored.join(", ")} back to Rested.`);
    else lines.push("Everyone was already rested.");
    // The premium tier clears accumulated worn-gear debt in one swipe (D47).
    if (res.debtCleared > 0) lines.push(`Cleared ${res.debtCleared} worn-gear debt — gear refit.`);
    if (res.dyingLost.length) lines.push(`Lost to wounds: ${res.dyingLost.join(", ")}.`);

    this.showOverlay("Rest", lines.join("\n"), true, 520, 220, () => this.afterNode());
  }

  // --- The REACT camp (post-encounter planning, D46/D80) ---------------------

  /**
   * The **REACT camp** (D80) — the now-informed, post-encounter planning beat: read the route
   * {@link "../../core".projectForecast | forecast} (D48), scout ahead, glance the ledger — then
   * **Set Out** (the soft gate back to the map) or rest in place first (D47, repeatable). The
   * gold route-forecast band up top is this beat's identity, against the prep beat's ember recap.
   */
  private showSurvey(): void {
    this.clearMap();
    this.clearCamp();
    clearLayer(this.overlay);
    this.campNode = currentNode(this.run);
    this.refreshCampText();
    // The live figures move to the right-side state panel on this beat — hide the line.
    this.campText.setVisible(false);

    // The REACT camp (D80): the post-encounter planning beat — read the road ahead, scout, bank
    // loot — ending in **Set Out**. Its identity is gold (intel/route), paired against the prep
    // beat's ember (the campfire).
    this.titleText.setText(`React — Night ${this.run.night} · the road ahead`);
    this.setHint("React camp: read the forecast, survey ahead — then Set Out (or rest in place first, repeatable).");

    const cx = this.scale.width / 2;
    const panelW = this.scale.width - 40; //  ~760 — nearly full width
    const panelTop = 60;
    const panelBottom = this.scale.height - 16; // ~584 — nearly full height
    const top = 92;
    const colX = cx - panelW / 2 + 30;
    const rowH = 30;

    const forecast = projectForecast(this.run);
    this.campObjects.push(
      // The gold rule — the react beat's intel/route identity (vs the prep beat's ember).
      this.add.rectangle(colX - 10, top - 20, 64, 3, COLOR.gold, 0.9).setOrigin(0, 0.5).setDepth(11),
      this.add.text(colX - 10, top - 6, "Route forecast", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
      this.add.text(colX - 10, top + 18, this.forecastSummary(forecast), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 5, wordWrap: { width: panelW - 60 } }).setOrigin(0, 0).setDepth(11),
    );
    const colTop = top + 26 + (forecast.perEdge.length + 1) * 18 + 14;
    const readoutCardW = 200;
    const readoutX = cx + panelW / 2 - 30 - readoutCardW;

    // Areas nav across the top of the action area (frees the width below for drawers).
    const areasBottom = this.renderAreaNav("camp", () => this.showSurvey(), this.campObjects, colX, colTop);
    let y = areasBottom + 20;

    // Live state readouts, stacked on the right of the action drawers.
    this.renderReadouts(readoutX, y, readoutCardW);

    // Intel drawer: survey a reachable node — raises its preview, tightening the forecast
    // (D48). Job-gated to the Scout; the whole drawer is absent when none is aboard. Each
    // row tags the surveying Scout, whose fatigue the cost readout shows (who's wearing down).
    const surveyor = this.surveyActor();
    const intel: CampAction[] = [];
    const survey = surveyor ? this.overworldNodeSkills(surveyor)[0] : undefined;
    if (surveyor && survey) {
      for (const target of this.loop.reachable()) {
        const refusal = this.refusal(survey, surveyor);
        intel.push({ label: `${survey.name} → ${target.id} · ${surveyor.name} (${this.costReadout(survey, surveyor)})`, enabled: !refusal, onClick: () => { this.loop.useOverworldSkill(surveyor, survey, { targetNodeId: target.id }); this.showSurvey(); }, tip: refusal ?? survey.description, preview: skillEffectPreview(survey, this.run) });
      }
    }
    y = this.renderDrawer("intel", "Intel", colX, y, rowH, intel, () => this.showSurvey());

    // The captain's running to-do sits below the actions.
    this.renderCaptainsJournal(colX, y + 12, panelW - 60);

    // The foot pairs the two ways to leave the react beat. Left: rest in place — repeatable, stay
    // put, greys at full HP / when broke (moved here from the Recovery drawer to sit beside its
    // sibling). Right: Set Out → — commit to the route and march to the map (the old Break Camp).
    const rest = this.inPlaceRestReadout();
    const footY = panelBottom - 30;
    this.campButton(cx - 250, footY, 240, 34, `Rest in place — ${rest.label}`, rest.enabled, () => this.doInPlaceRest(), rest.detail, inPlaceRestPreview(this.run));
    const setOutBtn = this.makeTextButton(cx + 130, footY, 240, 34, "Set Out →", COLOR.successDeep, COLOR.success, () => this.breakCampToMap());
    this.campObjects.push(setOutBtn);

    this.campObjects.push(
      this.add.rectangle(cx, (panelTop + panelBottom) / 2, panelW, panelBottom - panelTop, COLOR.surface, 0.96).setStrokeStyle(2, COLOR.border).setDepth(8),
    );
  }

  /** A compact text readout of the route forecast (D48) — runway (per-step burn + nearest rest)
   *  and the per-edge cost/loot. Route-planning, so it lives on the Survey panel (the ledger,
   *  an accounting view, no longer shows it). */
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
    const label = !wounded ? "party at full HP" : !affordable ? `need ${bill.total}g (broke)` : `pay ${bill.total}g`;
    return {
      label,
      detail: "In-place rest: pay a night's rations to bank RP + a small heal (floors at ≥1). Repeatable; each rest is a node-step (ticks cooldowns). Greys at full HP / when broke.",
      enabled,
    };
  }

  private doInPlaceRest(): void {
    // In-place rest is a node-step that pays a night's rations — show the spend first.
    this.showLedgerTransition("Before resting for the night…", () => {
      const res: InPlaceRestResult = this.loop.inPlaceRest();
      this.refreshCampText();
      if (res.applied) this.setHint(`Rested in place: −${res.goldSpent}g rations, +${res.hpHealed} HP, +${res.rpAdded} RP. Cooldowns ticked (a node-step passed).`);
      else this.setHint(`Can't rest: ${res.reason}`);
      if (this.loop.isOver()) return this.runEnd();
      this.showSurvey();
    });
  }

  /**
   * Break Camp → the storage-overflow discard (D75, a hard gate) → the soft
   * intent-aware night-end gate (D45) → the map. Grants land over the cap, so a
   * stash can leave a node over capacity; the player must choose what to let go
   * before they march. Within cap, this falls straight through to the soft gate.
   */
  private breakCampToMap(): void {
    // The night elapses at departure (D46) — show the ledger first so the spend is
    // seen (and Upkeep still crossable) before the soft gate and the march.
    const toGate = () => this.showLedgerTransition("Before resting for the night…", () => this.breakCampGate(), true);
    if (slotsOver(this.run.inventory) > 0) {
      this.showDiscardMenu(toGate);
      return;
    }
    toGate();
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

    // Full-screen backdrop (dims the camp + swallows clicks behind) — same as the Market and
    // ledger-transition modals; without it the camp bled through around the box (D75 gate).
    this.overlay.push(this.add.rectangle(cx, this.scale.height / 2, this.scale.width, this.scale.height, COLOR.black, 0.55).setDepth(23).setInteractive());
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
      const btn = this.makeTextButton(cx, y, 400, 30, `Discard 1 — ${mat?.name ?? id} ×${count} · Space: ${slots}${val}`, COLOR.surfaceRaised, COLOR.danger, () => {
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
      this.add.text(cx, cy - h / 2 + 24, "Before you set out…", { color: INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(25),
      this.add.text(cx, cy - h / 2 + 56, gate.reasons.map((r) => `• ${r}`).join("\n"), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, align: "left", lineSpacing: 5, wordWrap: { width: w - 60 } }).setOrigin(0.5, 0).setDepth(25),
    );
    const stay = this.makeTextButton(cx - 110, cy + h / 2 - 22, 180, 30, "Stay in camp", COLOR.surfaceRaised, COLOR.border, () => this.showSurvey()).setDepth(26);
    const go = this.makeTextButton(cx + 110, cy + h / 2 - 22, 180, 30, "Set out anyway", COLOR.danger, COLOR.danger, () => this.toMap()).setDepth(26);
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
    opts: { rerender: () => void; interactive?: boolean } = { rerender: () => this.renderTent() },
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
      this.overlay.push(
        this.add.text(leftX, y, `${cat.label}${tag}`, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(25),
        this.add.text(rightX, y, this.signed(cat.total), { color: cat.total < 0 ? INK.danger : INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(1, 0.5).setDepth(25),
      );
      g.lineStyle(1, COLOR.border, 0.5);
      g.lineBetween(leftX, y + rowH / 2, rightX, y + rowH / 2);
      y += rowH;

      for (const l of cat.lines) {
        const skipped = l.note === "voluntarily skipped";
        const skippable = (opts.interactive ?? true) && cat.id === "upkeep"; // only Upkeep lines are skippable, and only when the surface allows it
        const labelInk = skipped ? INK.disabled : skippable ? INK.bright : INK.secondary;
        this.overlay.push(
          this.add.text(leftX + 18, y, l.label, { color: labelInk, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(25),
        );
        // The amount on the right stays even when crossed off (D45) — dimmed and struck (below),
        // it's not in the total, but it tells the player what restoring the line would cost. A
        // skipped line's `amount` is 0 (out of the total), so show its `restoreAmount` instead.
        const shownAmount = skipped ? l.restoreAmount ?? l.amount : l.amount;
        this.overlay.push(
          this.add.text(rightX, y, this.signed(shownAmount), { color: skipped ? INK.disabled : shownAmount < 0 ? INK.danger : INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
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
          const hit = this.add.rectangle(cx, y, w - 2 * pad + 12, rowH, COLOR.surfaceAlt, 0).setDepth(24).setInteractive({ useHandCursor: true });
          hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
            hit.setFillStyle(COLOR.surfaceAlt, 0.35);
            this.setHint(skipped ? `Click to restore ${l.label} to the ledger (fund it again).` : `Click to cross ${l.label} off the ledger — frees its gold; you'll take the consequence and the gate won't nag.`);
          });
          hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => hit.setFillStyle(COLOR.surfaceAlt, 0));
          hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.toggleSkip(lineId, opts.rerender));
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

  /** Toggle a voluntary Upkeep skip (D45) — crosses the line off / restores it. The
   *  owning surface (Tent or night-end transition) supplies its own `rerender`. */
  private toggleSkip(id: UpkeepLine["id"], rerender: () => void = () => this.renderTent()): void {
    const set = new Set(this.run.camp.skippedUpkeep);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.run.camp.skippedUpkeep = [...set] as ("food" | "repairs")[];
    this.refreshCampText();
    this.setHint(set.has(id) ? `Crossed ${id} off the ledger — its gold is freed (you'll take the consequence; the gate won't nag).` : `${id} funded again.`);
    rerender();
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

  /**
   * The night-end ledger transition (D45) — a full-screen readout of what the night
   * costs, shown the instant **before** a night elapses (Break Camp, either rest tier)
   * so the spend is seen before it's locked in. On Break Camp the Upkeep lines stay
   * crossable (the soft gate honors the skip); the rest tiers force-pay, so there the
   * sheet is read-only. **Continue** runs `onContinue` — the deferred night action.
   */
  private showLedgerTransition(title: string, onContinue: () => void, interactive = false): void {
    clearLayer(this.overlay);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const w = 760;
    const h = Math.min(this.scale.height - 24, 540);
    const left = cx - w / 2;
    const top = cy - h / 2;

    // Full-screen backdrop (dims + swallows clicks behind) + the framed sheet.
    const backdrop = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, COLOR.black, 0.55).setDepth(22).setInteractive();
    this.overlay.push(
      backdrop,
      this.add.rectangle(cx, cy, w, h, COLOR.surface, 0.98).setStrokeStyle(2, COLOR.gold).setDepth(23),
      this.add.text(left + 24, top + 22, title, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0, 0.5).setDepth(25),
      this.add.text(left + w - 24, top + 22, "The night's tab — what camp spends before you move on.", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(25),
    );
    const rule = this.add.graphics().setDepth(24);
    rule.lineStyle(1, COLOR.borderSoft, 0.9);
    rule.lineBetween(left + 16, top + 44, left + w - 16, top + 44);
    this.overlay.push(rule);

    const contentTop = top + 56;
    const bounds = new Phaser.Geom.Rectangle(left + 8, contentTop, w - 16, h - (contentTop - top) - 52);
    this.drawLedgerSheet(bounds, { rerender: () => this.showLedgerTransition(title, onContinue, interactive), interactive });

    const btn = this.makeTextButton(cx, top + h - 24, 240, 32, "Continue →", COLOR.successDeep, COLOR.success, () => {
      clearLayer(this.overlay);
      onContinue();
    });
    this.overlay.push(btn.setDepth(26));
    this.setHint(interactive
      ? "Tonight's tab. Cross an Upkeep line off to free its gold (you'll take the consequence). Continue to rest for the night."
      : "Tonight's tab — what this rest will spend. Continue to proceed.");
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
