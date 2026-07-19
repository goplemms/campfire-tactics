import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import { PartyDossierView } from "../party-dossier-view";

/** The Captain's Tent tabs (D58) — the run's deep-info hub, one verb to open. */
type TentTab = "party" | "stores" | "ledger" | "map";
import {
  RunLoop,
  countOf,
  removeItem,
  slotsFor,
  slotsUsed,
  slotsOver,
  campReadoutLine,
  // M8 — the overworld action economy (D35) · D72 unified onto SkillDef
  overworldCostOf,
  resolveKnob,
  cooldownRemaining,
  fatigueTier,
  projectDossier,
  attentionCount,
  captainsJournal,
  projectManifest,
  getVessel,
  availableSkills,
  // R4/B (#112) — the one overworld-action projection the camp verb surfaces render.
  availableActions,
  combatRoster,
  // M10 — the gold economy verbs (D30/D34) + theft (D30)
  merchantBuy,
  // D61 — market access + the Merchant buy/sell faucet
  merchantSell,
  effectiveMarketTier,
  marketReadyAt,
  getMaterial,
  // D62 — the Noble's per-expedition Influence (presence accrual + Patronize)
  primaryJobOf,
  influenceTier,
  // M13 — the overworld economic layer (D45/D46/D47/D48)
  currentNode,
  projectForecast,
  buildLedger,
  nightEndGate,
  computeUpkeep,
  toggleUpkeepSkip,
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
  type ActionView,
  type ActionCostReadout,
  type ActionOpts,
  type EventDef,
  type RunState,
  type MapNode,
  type RestResult,
  type InPlaceRestResult,
  type EventOutcome,
  type EventChoice,
  type Unit,
  type SkillDef,
  type Guild,
  type Ledger,
  type RouteForecast,
  type UpkeepLine,
  type JournalConcern,
  type EquipSlot,
} from "../../core";
import { clearLayer } from "../ui";
import { captureRepro } from "../repro-capture";
import { Button, probeWidth } from "../button";
import { showModal, installBackdrop, renderChoiceStack } from "../overlay-card";
import { drawLedgerSheet } from "../ledger-sheet";
import { MapView, NODE_KIND_VISUALS } from "../map-view";
import { CampPanel, type CampAction, type ActionCost, type ActionPreview } from "../camp-panel";
import { drawMarket } from "../market-view";
import { renderChoicePanel } from "../event-panels";
import { HintPanel } from "../hint-panel";

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
  /**
   * Where the BattleScene returns on a terminal (or an explicit exit) instead of the overworld.
   * A scene **key** — set to `"EditorScene"` by the editor's soft-play (playtest) so a fought
   * draft bounces back to the editor, not into a nonsensical one-node "overworld". Generic on
   * purpose (any scene can host a run this way); absent ⇒ the normal return-to-map/hall path.
   */
  returnTo?: string;
  /**
   * Repro-restore only (debug): open the prep camp for this node id straight on boot, so a
   * restored dump lands on the exact pre-Begin screen ({@link "../repro-capture".restoreAndBoot}).
   * The run is already positioned there — this renders the camp without re-choosing/arriving.
   */
  reproCampNode?: string;
}

/** Buyable Market stock (D61) — trap kits first (the headline), then the Medic's herbs. */

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

/**
 * The camp/overworld effect kinds surfaced in the **Recovery** drawer (R4/B, #112) — the no-target
 * recovery/provision verbs, derived from {@link "../../core".availableActions}. The **economy** verbs
 * ({@link ECONOMY_DRAWER_ORDER}), the market trade (`buy`/`sell` — the Market overlay), the healer's
 * Triage (its own deduped row), and the node-aimed Survey (the Intel screen) each render elsewhere;
 * everything else non-node-aimed lands here (Cook Stew · Feast · Find Trade · Savvy Barter).
 */
const RECOVERY_DRAWER_KINDS: ReadonlySet<string> = new Set([
  "provisionMeal", "morale", "openMarket", "primeDeal",
]);

/**
 * The **Economy** drawer's verb order (R4/B, #112) — the Banker's purse-finance trio then the
 * Noble's Patronize, a fixed sequence so the drawer reads the same down every party (the projection
 * enumerates per fielded unit; this is the render's stable ordering). Deduped by kind, so one
 * financier's verbs show once even if the party fields two.
 */
const ECONOMY_DRAWER_ORDER: readonly string[] = ["engageInterest", "borrow", "guardPurse", "patronize"];

/** The Banker's Borrow amount surfaced by the camp button (a scene-side UI choice — the projection prices the once-per-node pacing, the amount is ours). */
const BORROW_AMOUNT = 40;

export class OverworldScene extends Phaser.Scene {
  private run!: RunState;
  private loop!: RunLoop;
  private guild?: Guild;
  private caravanId?: string;
  /** One-shot Expedition-demo intro flag (cleared after it shows once). */
  private demoIntro = false;
  /** Repro-restore only (debug): node id to open the prep camp for on boot (see RunHandoff). */
  private reproCampNode?: string;

  /** The overworld map board + pinned intel card (D22/D24/D48/D80) — its own view module. */
  private mapView!: MapView;
  private overlay: Phaser.GameObjects.GameObject[] = [];
  /** The current resting hint — a button's hover-hint restores to this on pointer-out
   *  (the `idle` sink, mirroring BattleScene.lastHint). */
  private restingHint = "";

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
  private hintPanel!: HintPanel;
  /** The shared camp-beat chrome (D58) — readout tiles + effect preview, drawers, action cards,
   *  camp buttons, nav tabs. The prep + react beats are two thin configurations of it. */
  private panel!: CampPanel;

  // The prep camp's "last night's rest" recap (D80): what the arrival rest healed / fatigue it
  // shed, captured by diffing the party across `loop.choose` in enterCamp. UI-only, per-arrival.
  private arrivalRecap: string[] = [];

  // The hover-preview layer: the transient preview objects (cleared on hover-out). Kept as a scene
  // layer (its readout geometry + pulse state live in the CampPanel); the panel pushes onto it.
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
    this.reproCampNode = data?.reproCampNode;
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
    this.hintPanel = new HintPanel(this);
    // The panel + map view are built once and persist across create() calls (a return from a
    // BattleScene re-runs create on the same scene instance) — matching the old instance-field
    // state, so the readout day-move baseline + the sticky intel node survive the battle round-trip.
    // The hint sink delegates to the live hintPanel (which IS recreated each create).
    this.panel ??= new CampPanel({
      scene: this,
      run: () => this.run,
      campObjects: () => this.campObjects,
      previewObjects: () => this.previewObjects,
      drawers: () => this.campDrawers,
      hint: { setText: (t) => this.hintPanel.setText(t) },
    });
    this.mapView ??= new MapView(this, {
      getRun: () => this.run,
      reachable: () => this.loop.reachable(),
      onChoose: (node) => this.enterCamp(node),
      setHint: (t) => this.setHint(t),
      renderReadouts: (layer) => this.panel.renderMapReadouts(40, layer),
    });


    // Terminal screens take over the map.
    if (this.loop.isOver()) return this.runEnd();
    if (this.loop.isComplete()) return this.runComplete();

    // Returning from a resolved node (e.g. back from a combat BattleScene) lands on
    // the **Survey** beat (D46) — the now-informed post-event planning surface —
    // before the map. A fresh run sits at the un-played start node → straight to map.
    if (this.justResolvedCurrentNode()) return this.showReactCamp();

    // Repro-restore (debug): a restored dump lands straight on the captured node's prep camp
    // (the pre-Begin screen) so a reported freeze reproduces on the first click. The run is
    // already positioned at the node, so this renders the camp directly — no re-choose/arrival.
    if (this.reproCampNode) {
      const node = this.run.map.nodes[this.reproCampNode];
      this.reproCampNode = undefined;
      if (node) {
        this.drawMap();
        this.clearMap();
        this.campNode = node;
        this.renderCamp();
        return;
      }
    }

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
    showModal(this, this.overlay, {
      title: "The Long Road Home — an Expedition",
      tone: "good",
      w,
      h,
      cy,
      body: { text: body, offset: 52, originX: 0, padX, originY: 0, color: INK.secondary, font: FONT.label, lineSpacing: 5 },
    });
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
    this.showReactCamp();
  }

  // --- Map drawing ----------------------------------------------------------

  /** Draw the overworld board via {@link MapView}: set the map title, then hand off to the view.
   *  `interactive: false` is the read-only Route-map review (Tent Map page). */
  private drawMap(interactive = true): void {
    this.titleText.setText(`Overworld — Night ${this.run.night + 1} · choose your next move`);
    this.mapView.draw(interactive);
  }

  // --- Selection / preview (D24) --------------------------------------------

  /** Inspect a node — pin its intel card (sticky until the player inspects another). The map
   *  view owns the card; the only caller is now the screenshot harness (`s.showPreview(node)`). */
  showPreview(node: MapNode): void {
    this.mapView.inspect(node);
  }

  /**
   * Player-facing labels for the reachable survey targets (D80 polish) — a node's **kind + depth**
   * (e.g. "Combat (L2)") instead of its raw internal id ("n2-2"). Two reachable nodes that share a
   * label get a trailing "#2" so each row still points at a distinct node.
   */
  private reachableTargetLabels(nodes: { id: string; kind: MapNode["kind"]; layer: number }[]): Record<string, string> {
    const word = (k: MapNode["kind"]) => NODE_KIND_VISUALS[k].word;
    const base = (n: { kind: MapNode["kind"]; layer: number }) => `${word(n.kind)} (L${n.layer})`;
    const counts: Record<string, number> = {};
    for (const n of nodes) counts[base(n)] = (counts[base(n)] ?? 0) + 1;
    const used: Record<string, number> = {};
    const out: Record<string, string> = {};
    for (const n of nodes) {
      const b = base(n);
      out[n.id] = counts[b] > 1 ? `${b} #${(used[b] = (used[b] ?? 0) + 1)}` : b;
    }
    return out;
  }

  private clearMap(): void {
    this.mapView.clear();
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
      renderChoicePanel(this, this.overlay, {
        title: `On the road — ${def.name}`,
        body: def.teaser,
        gold: this.run.camp.gold,
        choices,
        onPick: (c) => this.onEarlyChoice(node, def, c),
        btnW: 380,
        make: this.makeTextButton.bind(this),
        onHint: (t) => this.setHint(t),
      });
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
  /** Apply a tailored early-event choice: a bypass short-circuits to the react camp; otherwise fight on. */
  private onEarlyChoice(node: MapNode, def: EventDef, choice: EventChoice): void {
    const out: EventOutcome = def.choose!(this.run, node, choice.id);
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
    // Repro capture (debug): snapshot the pre-Begin state — the exact surface a Begin freeze
    // happens on — so it can be dumped (Shift+D) even after the render wedges.
    captureRepro(this.run, { scene: "OverworldScene", phase: "prep-camp", node: node.id });
    this.clearCamp();

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
    this.panel.renderReadouts(readoutX, bodyTop + 5, readoutCardW);

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
      this.panel.navButton(bx, y, bw, h, e.label, e.id === active, e.onClick, e.tip, layer);
      bx += bw + gap;
    }
    return y + h / 2;
  }

  /** Compact toolbar variant of the tent label — "Tent" (+ a ⚠ attention badge). */
  private tentToolbarLabel(): string {
    const n = attentionCount(projectDossier(this.run));
    return n > 0 ? `Tent  ⚠${n}` : "Tent";
  }

  /** Width for a compact toolbar button sized to fit its label (measured + side padding). */
  private measureButtonWidth(label: string): number {
    return Math.ceil(probeWidth(this, label, FONT.label)) + 24;
  }

  /**
   * The camp actions, grouped into collapsible **category drawers**: Recovery (cook /
   * heal) then Economy (the Banker/Noble finance verbs). Each drawer shows a count and
   * hides entirely when it holds nothing the party can do. (Market trade lives in the
   * gated Market overlay, reached from the areas column.) Returns the `y` past the last row.
   */
  private renderCampActions(colX: number, top: number, rowH: number): number {
    let y = top;
    y = this.panel.renderDrawer("recovery", "Recovery", colX, y, rowH, this.campRecoveryActions(), () => this.renderCamp());
    y = this.renderEconomyDrawer(colX, y, rowH);
    return y + 8;
  }

  /**
   * The **Recovery** actions on the camp beat (R4/B, #112) — a **render of {@link
   * "../../core".availableActions}**, no longer hand-wired: every fielded unit's no-target recovery
   * verb ({@link RECOVERY_DRAWER_KINDS} — Cook Stew · Feast · Find Trade · Savvy Barter), tagged with
   * the member who acts, plus the party's single Triage row ({@link triageRow}). The economy verbs,
   * the market trade, and the node-aimed Survey surface on their own surfaces. Each row's gate verdict
   * + cost readout come straight off the projection — the D80 layout stays, the wiring is the twin of
   * combat's `availableSkills`.
   */
  private campRecoveryActions(): CampAction[] {
    const out: CampAction[] = [];
    for (const view of availableActions(this.run)) {
      if (!RECOVERY_DRAWER_KINDS.has(view.effectKind)) continue;
      const row = this.actionRow(view);
      if (row) out.push(row);
    }
    const triage = this.triageRow();
    if (triage) out.push(triage);
    return out;
  }

  /**
   * The party's single **Triage** row (R4/B, #112) — the healer's full-strength fatigue heal when a
   * healing class is aboard, else the universal RP-funded fallback (the ratified named change: a
   * Medic-less party heals slower). Deduped from the projection's per-unit triage views (the Medic's
   * `triage` preferred over the universal fallback). Greyed with no wounded fighter — a target
   * condition the gate doesn't read, so the render layers it on. Absent only if no unit surfaces
   * triage at all (never, since the fallback is universal).
   */
  private triageRow(): CampAction | undefined {
    const views = availableActions(this.run).filter((v) => v.effectKind === "triage");
    const view = views.find((v) => v.id === "triage") ?? views[0];
    if (!view) return undefined;
    const found = this.actionSkill(view);
    if (!found) return undefined;
    const { unit, skill } = found;
    const full = skill.id === "triage"; // the Medic's full-strength Triage (vs the universal fallback)
    const someoneWounded = combatRoster(this.run).some((u) => u.hp < u.maxHp);
    const tip = !someoneWounded
      ? "No wounded fighter to triage."
      : full
        ? `${unit.name} (healer) spends fatigue to mend the most-wounded fighter — more the worse the wound. Pure stamina, no Rest Points; a worn-out healer must rest first.`
        : skill.description;
    return {
      label: `${skill.name} · ${unit.name}`,
      name: skill.name,
      actor: unit.name,
      enabled: someoneWounded && view.verdict.ok,
      onClick: () => this.useCampSkill(unit, skill),
      tip,
      preview: full ? triageActionPreview() : skillEffectPreview(skill, this.run),
      costs: this.viewCosts(view.cost),
    };
  }

  /**
   * Resolve the fielded unit + its overworld {@link SkillDef} behind a projection {@link ActionView}
   * (keyed by `actorId` + `id`) — the render needs the live `SkillDef` for the tip/description and
   * hover preview, and the `Unit` to dispatch through the one interpreter. `undefined` if the actor
   * left the field or no longer surfaces the skill (stale view).
   */
  private actionSkill(view: ActionView): { unit: Unit; skill: SkillDef } | undefined {
    const unit = this.run.party.find((u) => u.id === view.actorId);
    if (!unit) return undefined;
    const skill = availableSkills(unit, "overworld").find((s) => s.id === view.id);
    return skill ? { unit, skill } : undefined;
  }

  /**
   * Map a projection {@link ActionCostReadout} onto the render's cost-chip model ({@link ActionCost}
   * — gold / fatigue / material / cooldown). The pacing axes (per-node uses) and the RP/Influence
   * prices aren't chip components, so they're carried by the tip/preview, not the chip row (parity
   * with the pre-projection `actionCost`).
   */
  private viewCosts(cost: ActionCostReadout): ActionCost {
    return {
      gold: cost.gold,
      fatigue: cost.fatigue,
      material: cost.material ? { id: cost.material.id ?? "", n: cost.material.count } : undefined,
      cooldown: cost.cooldown,
    };
  }

  /**
   * The hover **effect preview** for a projection row — the finance/triage verbs keep their bespoke
   * readouts (interest/debt/protection/influence/heal); everything else derives from the skill's
   * declared cost + effect ({@link "../../core".skillEffectPreview}). Selection by effect kind is a
   * presentation concern layered on the projection's list.
   */
  private actionPreview(view: ActionView, skill: SkillDef): ActionPreview {
    switch (view.effectKind) {
      case "engageInterest": return bankerInterestPreview(this.run);
      case "borrow": return bankerBorrowPreview(BORROW_AMOUNT);
      case "guardPurse": return bankerProtectPreview();
      case "patronize": return patronizePreview();
      default: return skillEffectPreview(skill, this.run);
    }
  }

  /**
   * Build a camp **action row** from a projection {@link ActionView} (R4/B, #112) — the shared mapper
   * the Recovery + Economy drawers render through. Label/actor/cost come off the projection (gate
   * verdict → enabled, why-refused → tip); the SkillDef supplies the description + preview. The
   * Banker's **Borrow** is the one scene-side amount choice ({@link BORROW_AMOUNT}) — surfaced on the
   * label and passed as the dispatch opt. Dispatched through the one interpreter ({@link useCampSkill}).
   */
  private actionRow(view: ActionView): CampAction | undefined {
    const found = this.actionSkill(view);
    if (!found) return undefined;
    const { unit, skill } = found;
    const borrow = view.effectKind === "borrow";
    const name = borrow ? `${skill.name} ${BORROW_AMOUNT}g` : skill.name;
    const opts: ActionOpts = borrow ? { amount: BORROW_AMOUNT } : {};
    return {
      label: `${name} · ${unit.name}`,
      name,
      actor: unit.name,
      enabled: view.verdict.ok,
      onClick: () => this.useCampSkill(unit, skill, opts),
      tip: view.verdict.ok ? skill.description : view.verdict.reason,
      preview: this.actionPreview(view, skill),
      costs: this.viewCosts(view.cost),
    };
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
   * The **Economy** drawer on the camp beat (R4/B, #112) — a **render of {@link
   * "../../core".availableActions}**: the Banker's purse-finance verbs (Invest / Borrow / Guard) and
   * the Noble's Patronize, in the fixed {@link ECONOMY_DRAWER_ORDER} and deduped by kind (one
   * financier's verbs show once). Each is shown only when its class is fielded (the projection folds
   * the job home), tagged with who works it; verdict → enabled, cost readout → the chips. The everyday
   * market trade (buy supplies / sell salvage) lives in the gated **Market** overlay, not here. Hidden
   * entirely when the party fields no financier. Returns the `y` past it.
   */
  private renderEconomyDrawer(colX: number, y: number, rowH: number): number {
    const seen = new Set<string>();
    const views = availableActions(this.run)
      .filter((v) => ECONOMY_DRAWER_ORDER.includes(v.effectKind) && !seen.has(v.effectKind) && seen.add(v.effectKind))
      .sort((a, b) => ECONOMY_DRAWER_ORDER.indexOf(a.effectKind) - ECONOMY_DRAWER_ORDER.indexOf(b.effectKind));
    if (views.length === 0) return y;
    y = this.panel.drawerHeader(colX, y, 360, "economy", "Economy", views.length, () => this.renderCamp());
    if (!this.campDrawers.economy) return y;
    const childX = colX + 14;
    const childW = 346;
    // The financier verbs (D30/D62) — directly under Economy (single nesting), tagged with who works
    // them (the card grammar: verb · unit · cost components). Effects (interest, the borrow, protection,
    // patronage) ride the hover EFFECT PREVIEW; the cost column carries the gold spend, all off the
    // projection's readout.
    for (const view of views) {
      const row = this.actionRow(view);
      if (!row) continue;
      this.panel.renderActionCard(childX, y, childW, 26, row);
      y += rowH;
    }
    // The Banker's/Noble's purse-state, surfaced in context (D58). The Influence line shows whenever a
    // Noble is aboard (standing accrues even before Patronize), or when any standing is banked.
    const noble = this.jobActor("noble");
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
    drawLedgerSheet(this, this.overlay, {
      bounds: b,
      ledger: this.buildRunLedger(),
      onToggleSkip: (id) => this.toggleSkip(id, () => this.renderTent()),
      onHint: (t) => this.setHint(t),
    });
  }

  /** Build the run's {@link Ledger} for the sheet (D45/D48) — realized + projected gold flow at
   *  the node we're camped at (or the current node). The two ledger hosts pass the result in. */
  private buildRunLedger(): Ledger {
    const node = this.campNode ?? currentNode(this.run);
    return buildLedger(this.run, { influence: this.run.overworld.influence, marketReady: marketReadyAt(this.run, node) });
  }

  /**
   * Dispatch a camp/overworld verb through the **one interpreter** ({@link RunLoop.useOverworldSkill})
   * — the shared click path for every Recovery + Economy row (R4/B, #112): the class/capability home,
   * the two-axis cost gate, the effect, its commit + use-XP all live in core. `opts` carries the
   * verb's extra inputs (the Banker Borrow's amount). Gated by the per-node cap (D35): a signature
   * action levels its owner now (D32/D53) but can't be spammed for unlimited gold/morale/XP.
   */
  private useCampSkill(actor: Unit, skill: SkillDef, opts: ActionOpts = {}): void {
    const res = this.loop.useOverworldSkill(actor, skill, opts);
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
    drawMarket(this, this.overlay, {
      run: this.run,
      node: this.campNode ?? currentNode(this.run),
      marketQty: this.marketQty,
      caravan: this.caravanInfo(),
      make: this.makeTextButton.bind(this),
      onBuy: (id, qty) => this.marketBuy(id, qty),
      onSellAll: () => this.sellValuables(),
      onClose: () => this.closeMarket(),
      rerender: () => this.renderMarket(),
    });
  }

  /** Delegate to the camp panel — kept on the scene as the screenshot harness's entry
   *  point (`s.renderActionCard(...)`) into the action-card chrome. */
  renderActionCard(x: number, y: number, w: number, h: number, a: CampAction): void {
    this.panel.renderActionCard(x, y, w, h, a);
  }

  /** Delegate to the camp panel — the screenshot harness's entry point (`s.showActionPreview(...)`)
   *  into the hover effect-preview area. */
  showActionPreview(preview: ActionPreview | null): void {
    this.panel.showActionPreview(preview);
  }

  private clearCamp(): void {
    // Drop any transient hover-tip whose button we're about to destroy (#137): a hovered camp/nav
    // button rebuilt out from under the pointer never fires its pointer-out, so the tip would stick.
    // clearCamp is the single teardown all camp beats + renderTent route through, so this covers both.
    this.hintPanel.clearTip();
    // Stop any in-flight readout pulses (+ drop the preview geometry) before their tiles are
    // destroyed below — the panel owns that state; the shared layers are cleared here.
    this.panel.clearReadouts();
    clearLayer(this.previewObjects);
    clearLayer(this.campObjects);
  }

  /** Leave the camp and play the node (D35): combat hands off; rest recovers here. */
  private commit(): void {
    const node = this.campNode!;
    // Repro capture (debug): snapshot at the moment of the risky handoff (Begin), tagged with
    // the node kind we're about to play — so a freeze in the transition is reproducible.
    captureRepro(this.run, { scene: "OverworldScene", phase: `commit:${node.kind}`, node: node.id });
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
    this.afterNode();
  }

  // Thief — no choice; resolve the skim (auto path) and report it (D30).
  private playThiefEvent(): void {
    const res = this.loop.eventNode(); // auto-resolves the skim + records the night
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
    const def = this.loop.eventDef();
    // A story event surfaces its authored `StorySpec.prompt` via `EventDef.prompt` — set by
    // both the seeded random-pool node ("story") and an **authored, pinned** offer (a guild
    // beat, eventId-bound), so the guild's fence/rite reads its full flavour, not the short
    // map teaser (#179). Falls back to the teaser if a def supplies no prompt. Its choices
    // come from the loop's eventChoices either way. (`campNode` is already cleared by
    // commit(), so read currentNode.)
    const body = def.prompt?.(this.run, currentNode(this.run)) ?? def.teaser;
    this.renderEventChoicePanel(def.name, body);
  }

  /**
   * The shared event-choice panel (M11): the event's choices as buttons. Shop buys
   * leave the panel open (buy several, then Leave); a recruiter/story pick is
   * terminal (it resolves and continues). Re-rendered after each shop buy so the
   * readouts (purse, availability) stay live.
   */
  private renderEventChoicePanel(title: string, body: string): void {
    const def = this.loop.eventDef();
    // A shop is a multi-buy surface — add an explicit Leave that records the step.
    const extraRow =
      def.kind === "shop"
        ? {
            label: "Leave the market",
            onPick: () => {
              clearLayer(this.overlay);
              this.finishEvent(-this.spentAtShop);
            },
          }
        : undefined;
    renderChoicePanel(this, this.overlay, {
      title,
      body,
      gold: this.run.camp.gold,
      choices: this.loop.eventChoices(),
      onPick: (c) => this.onEventChoice(c),
      btnW: 360,
      extraRow,
      make: this.makeTextButton.bind(this),
      onHint: (t) => this.setHint(t),
    });
  }

  /** Apply a chosen event option, then re-render (shop) or continue (terminal). */
  private onEventChoice(choice: EventChoice): void {
    const def = this.loop.eventDef();
    const out: EventOutcome = this.loop.chooseEvent(choice.id);

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
    const good = out.goldDelta >= 0 && out.moraleDelta >= 0;
    this.showOverlay(def.name, lines.join("\n"), good, 520, 200, () => this.afterNode());
  }

  // --- Rest node (D23) -------------------------------------------------------

  private playRest(): void {
    // A rest node elapses a night and pays a night's rations — show the spend first.
    this.showLedgerTransition("Before resting for the night…", () => {
      const res = this.loop.restNode();
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
  private showReactCamp(): void {
    this.clearMap();
    this.clearCamp();
    clearLayer(this.overlay);
    this.campNode = currentNode(this.run);

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
    const areasBottom = this.renderAreaNav("camp", () => this.showReactCamp(), this.campObjects, colX, colTop);
    let y = areasBottom + 20;

    // Live state readouts, stacked on the right of the action drawers.
    this.panel.renderReadouts(readoutX, y, readoutCardW);

    // Intel drawer: survey a reachable node — raises its preview, tightening the forecast
    // (D48). Job-gated to the Scout; the whole drawer is absent when none is aboard. Each
    // row tags the surveying Scout, whose fatigue the cost readout shows (who's wearing down).
    const surveyor = this.surveyActor();
    const intel: CampAction[] = [];
    const survey = surveyor ? this.overworldNodeSkills(surveyor)[0] : undefined;
    if (surveyor && survey) {
      const reach = this.loop.reachable();
      const targetLabels = this.reachableTargetLabels(reach);
      for (const target of reach) {
        const refusal = this.refusal(survey, surveyor);
        const label = targetLabels[target.id];
        intel.push({ label: `${survey.name} → ${label} · ${surveyor.name} (${this.costReadout(survey, surveyor)})`, enabled: !refusal, onClick: () => { this.loop.useOverworldSkill(surveyor, survey, { targetNodeId: target.id }); this.showReactCamp(); }, tip: refusal ?? survey.description, preview: skillEffectPreview(survey, this.run), name: `${survey.name} → ${label}`, actor: surveyor.name, costs: this.actionCost(survey) });
      }
    }
    y = this.panel.renderDrawer("intel", "Intel", colX, y, rowH, intel, () => this.showReactCamp());

    // The captain's running to-do sits below the actions.
    this.renderCaptainsJournal(colX, y + 12, panelW - 60);

    // The foot pairs the two ways to leave the react beat. Left: rest in place — repeatable, stay
    // put, greys at full HP / when broke (moved here from the Recovery drawer to sit beside its
    // sibling). Right: Set Out → — commit to the route and march to the map (the old Break Camp).
    const rest = this.inPlaceRestReadout();
    const footY = panelBottom - 30;
    this.panel.campButton(cx - 250, footY, 240, 34, `Rest in place — ${rest.label}`, rest.enabled, () => this.doInPlaceRest(), rest.detail, inPlaceRestPreview(this.run));
    const setOutBtn = this.makeTextButton(cx + 130, footY, 240, 34, "Set Out →", COLOR.successDeep, COLOR.success, () => this.setOutToMap());
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
    // Label each edge by its node's kind + depth ("Combat (L2)"), not the raw id ("n2-2"). The
    // forecast's edges are the reachable set, all one layer ahead — so the layer is uniform (D80 polish).
    const nextLayer = currentNode(this.run).layer + 1;
    const labels = this.reachableTargetLabels(f.perEdge.map((e) => ({ id: e.nodeId, kind: e.kind, layer: nextLayer })));
    for (const e of f.perEdge) {
      const loot = e.lootBand.label ?? (e.lootBand.floor > 0 ? `≥${e.lootBand.floor}g` : "unknown");
      const ceil = e.purseAfter.ceiling === undefined ? "…" : `${e.purseAfter.ceiling}g`;
      lines.push(`${e.warn ? "⚠ " : "  "}${labels[e.nodeId]}: cost ${e.costKnown}g · loot ${loot} → purse ${e.purseAfter.floor}…${ceil}`);
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
    const streak = this.run.overworld.restStreak;
    return {
      label,
      detail: `In-place rest: linger a night on this node — pay a night's rations to heal the **whole wounded party** (worst-first, down the RP pool) and step Fatigue down a tier. Repeatable; each night is a node-step (ticks cooldowns).${streak > 0 ? ` Rested here ${streak} night(s) so far.` : ""} Greys at full HP / when broke.`,
      enabled,
    };
  }

  private doInPlaceRest(): void {
    // In-place rest is a node-step that pays a night's rations — show the spend first.
    this.showLedgerTransition("Before resting for the night…", () => {
      const res: InPlaceRestResult = this.loop.inPlaceRest();
      if (res.applied) {
        const who = res.healed.length === 1 ? "1 fighter" : `${res.healed.length} fighters`;
        this.setHint(`Rested in place (night ${res.streak} here): −${res.goldSpent}g rations, +${res.hpHealed} HP across ${who}, +${res.rpAdded} RP. A node-step passed.`);
      } else this.setHint(`Can't rest: ${res.reason}`);
      if (this.loop.isOver()) return this.runEnd();
      this.showReactCamp();
    });
  }

  /**
   * Break Camp → the storage-overflow discard (D75, a hard gate) → the soft
   * intent-aware night-end gate (D45) → the map. Grants land over the cap, so a
   * stash can leave a node over capacity; the player must choose what to let go
   * before they march. Within cap, this falls straight through to the soft gate.
   */
  private setOutToMap(): void {
    // The night elapses at departure (D46) — show the ledger first so the spend is
    // seen (and Upkeep still crossable) before the soft gate and the march.
    const toGate = () => this.showLedgerTransition("Before resting for the night…", () => this.setOutGate(), true);
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
    const carried = Object.keys(inv.counts)
      .filter((id) => inv.counts[id] > 0)
      .sort((a, b) => (getMaterial(a)?.name ?? a).localeCompare(getMaterial(b)?.name ?? b));
    const w = 560;
    const h = 140 + carried.length * 38;

    // The modal always installs the input-swallowing backdrop; without it the camp bled
    // through around the box (D75 gate).
    const handle = showModal(this, this.overlay, {
      title: "Storage overflowing — let something go",
      tone: "bad",
      w,
      h,
      cy: this.scale.height / 2 - 10,
      boxAlpha: 0.97,
      depth: 24,
      body: {
        text: `Storage ${slotsUsed(inv)}/${inv.storageCap} — ${over} slot${over === 1 ? "" : "s"} over the cap. Discard until it fits to break camp.`,
        offset: 54,
        lineSpacing: 0,
      },
    });
    renderChoiceStack(this.overlay, handle, {
      choices: carried.map((id) => {
        const mat = getMaterial(id);
        const count = countOf(inv, id);
        const slots = mat ? slotsFor(mat, count) : count; // the row's current slot footprint (stacks pack)
        const val = mat?.saleValue ? ` · ${mat.saleValue}g ea` : "";
        return {
          label: `Discard 1 — ${mat?.name ?? id} ×${count} · Space: ${slots}${val}`,
          fill: COLOR.surfaceRaised,
          stroke: COLOR.danger,
          // Stacked goods (a half-stack of herbs) share a slot — dropping one may not free space until the stack empties.
          detail: `Drop one ${mat?.name ?? id}. Whole stacks free a slot; a partial stack frees one only when it empties. Lowest-value gear is the usual cut.`,
          onPick: () => {
            removeItem(inv, id, 1);
            this.showDiscardMenu(onDone); // re-render; auto-closes once back within cap
          },
        };
      }),
      startOffset: 96,
      step: 38,
      btnW: 400,
      btnH: 30,
      buttonDepth: 26,
      make: this.makeTextButton.bind(this),
      onHint: (t) => this.setHint(t),
    });
  }

  /** The soft, intent-aware night-end gate (D45) → the map (overflow already cleared). */
  private setOutGate(): void {
    const gate = nightEndGate(this.run);
    if (!gate.warn) return this.toMap();
    // Hard-stop with a forced look only when warranted; never a per-night chore.
    clearLayer(this.overlay);
    const cy = this.scale.height / 2 - 10;
    const w = 560;
    const h = 150 + gate.reasons.length * 18;
    const handle = showModal(this, this.overlay, {
      title: "Before you set out…",
      tone: "bad",
      w,
      h,
      cy,
      boxAlpha: 0.97,
      depth: 24,
      body: { text: gate.reasons.map((r) => `• ${r}`).join("\n"), offset: 56, originY: 0, textAlign: "left", lineSpacing: 5 },
    });
    const stay = this.makeTextButton(handle.cx - 110, cy + h / 2 - 22, 180, 30, "Stay in camp", COLOR.surfaceRaised, COLOR.border, () => this.showReactCamp()).setDepth(26);
    const go = this.makeTextButton(handle.cx + 110, cy + h / 2 - 22, 180, 30, "Set out anyway", COLOR.danger, COLOR.danger, () => this.toMap()).setDepth(26);
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

  /** Toggle a voluntary Upkeep skip (D45) — crosses the line off / restores it. The
   *  owning surface (Tent or night-end transition) supplies its own `rerender`. */
  private toggleSkip(id: UpkeepLine["id"], rerender: () => void = () => this.renderTent()): void {
    toggleUpkeepSkip(this.run, id); // core owns the rule (no more render-side type-assertion write)
    const nowSkipped = this.run.camp.skippedUpkeep.includes(id);
    this.setHint(nowSkipped ? `Crossed ${id} off the ledger — its gold is freed (you'll take the consequence; the gate won't nag).` : `${id} funded again.`);
    rerender();
  }

  // --- Terminal screens ------------------------------------------------------

  private runComplete(): void {
    this.drawTerminalReadout();
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
    this.drawTerminalReadout();
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

  /** The terminal screens' readout line (D58) — the four decision-relevant groups (Purse, Morale,
   *  Storage/Kits, RP/Upkeep), formatted by core `campReadoutLine`. Replaces the old always-on
   *  `campText` field, which every beat hid and only the terminals showed by accident of ordering (#137). */
  private drawTerminalReadout(): void {
    this.add.text(this.scale.width / 2, 40, campReadoutLine(this.run), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0.5).setDepth(10);
  }

  private setHint(text: string): void {
    this.restingHint = text;
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
    installBackdrop(this, this.overlay, 22);
    this.overlay.push(
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
    drawLedgerSheet(this, this.overlay, {
      bounds,
      ledger: this.buildRunLedger(),
      interactive,
      onToggleSkip: (id) => this.toggleSkip(id, () => this.showLedgerTransition(title, onContinue, interactive)),
      onHint: (t) => this.setHint(t),
    });

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
    const cy = this.scale.height / 2 - 20;
    const handle = showModal(this, this.overlay, {
      title,
      tone: good ? "good" : "bad",
      w,
      h,
      cy,
      boxAlpha: 0.94,
      titleOffset: 26,
      // The body sits centred in the tall box (cy + 6), not tucked under the title.
      body: { text: body, offset: h / 2 + 6, wrapInset: 48 },
    });
    if (onContinue) {
      this.overlay.push(
        this.makeTextButton(handle.cx, cy + h / 2 - 20, 160, 30, "Continue", COLOR.successDeep, COLOR.success, () => {
          clearLayer(this.overlay);
          onContinue();
        }),
      );
    }
  }

  private makeTextButton(x: number, y: number, w: number, h: number, text: string, fill: number, stroke: number, onClick: () => void, description?: string): Button {
    const btn = new Button(this, x, y, {
      text,
      w,
      h,
      fill,
      stroke,
      onClick,
      // The same hover-hint wiring BattleScene's wrapper has (#134): show `description`
      // on hover, restore the resting hint on out. Omitted (no sink) when no description.
      hint: description !== undefined ? { bar: this.hintPanel, description, idle: () => this.restingHint } : undefined,
    });
    this.add.existing(btn).setDepth(22);
    return btn;
  }
}
