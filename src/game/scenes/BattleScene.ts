import Phaser from "phaser";
import { COLOR, FONT, INK, WEIGHT } from "../theme";
import { roleColor } from "../roles";
import { CombatView } from "../combat-view";
import { addVignette } from "../vignette";
import {
  reachableTiles,
  moveBudget,
  isImmobilized,
  inAttackRange,
  refreshAuras,
  isAdjacent,
  TileGrid,
  Battle,
  availableSkills,
  getJob,
  primaryJobOf,
  onSkillCooldown,
  DEFEND,
  isValidSkillTarget,
  canSee,
  // M5b/D11 — deployment: the shared stealth-alert model
  countOf,
  freeCaptive,
  canRelease,
  canLockpickGate,
  canAttackGate,
  canPullLever,
  type Gate,
  type Lever,
  // D63 — the closing net: two radial influence sources. The party's campfire
  // (safe ground, sized by presence) vs. the enemy source (danger, growing on the
  // deployment clock); the danger overrides the campfire, shrinking your territory.
  createFront,
  createCampfire,
  configureDeployClock,
  resolveFrontTurn,
  inDangerZone,
  isProtected,
  deployForecast,
  // D63/D60 Phase B — the pure deploy/battle-flow decisions (headless, vitest-
  // tested), so the scene renders the choices instead of making them.
  frontTurnStage,
  deployActions,
  advanceOutcome,
  noActionsAvailable as scanNoActions,
  adjacentRevealedTrap as findAdjacentRevealedTrap,
  // M5 — camp / morale
  moraleTier,
  moraleModifiers,
  // M6 — the run loop
  currentEncounter,
  encounterOutcome,
  jobLevelOf,
  // M10 — theft (D30) + mid-combat bribe → recruitment (D33)
  thiefSteal,
  Labels,
  recoverStolen,
  thiefEscapes,
  previewNode,
  scoutedTier,
  // D8/D10 — the deploy edge: morale folded with the intel bundle (core-owned math)
  deployModifiers,
  // D84 — standing-order behaviors: the stance telegraph + transition narration
  STANDING_ORDERS,
  // D12 — the enemy trap-field: spot, search, and Survivalist disarm
  isConcealedTrap,
  hiddenTraps,
  revealTrapsNear,
  spotWhileMoving,
  disarmTrap,
  canDisarm,
  type ConcealedTrap,
  type PlaceTrapEffect,
  type MaterialCost,
  bribeEnemy,
  bribeCost,
  bribeChance,
  influenceTier,
  recruitToRoster,
  medicalHerbs,
  type RunState,
  type RunLoop,
  type IntelReport,
  type DeployFront,
  type DeploySource,
  type Rng,
  type GridCoord,
  type Unit,
  type SkillDef,
  type TheftAttempt,
} from "../../core";
import type { RunHandoff } from "./OverworldScene";
import { Button, probeWidth } from "../button";
import { CommandMenu, type ActionSpec, MENU_BW, MENU_PAD, MENU_LEFT } from "../command-menu";
import { PreviewCardController, attackPreviewRows as computeAttackPreviewRows } from "../forecast-cards";
import { SituationCard, type SituationCtx, type CardView } from "../situation-card";
import { buildResolutionSummary, showResolutionReport } from "../resolution-report";
import { paintZones, drawSourceMarkers } from "../deploy-zones";
import { TrapMarkerLayer } from "../trap-markers";
import { showModal } from "../overlay-card";
import { isScreenshotMode, clearLayer } from "../ui";
import { captureRepro } from "../repro-capture";
import { HintPanel } from "../hint-panel";
import { LegendStrip, DEPLOY_LEGEND, BATTLE_LEGEND, EXIT_LEGEND_ITEM } from "../legend-strip";
import { MiniCard, type CardRow } from "../info-cards";
import { dropNet as dropNetCage } from "../deploy-fx";
import { ICON, placeIcon } from "../icons";

/**
 * Board zoom for the real combat field (D-UX): enlarge tiles + tokens so details
 * (HP bars, nameplates, status pips) stand out — the procedural 8×6 board is
 * centred full-width and has the room. Applied via {@link CombatView.boardScale}.
 */
const BOARD_SCALE = 1.4;

/**
 * The two interactive board phases that share the scene's render/interaction path
 * (D-feel: deployment ↔ combat parity). Several verbs — Search, Disarm, the click-ahead
 * replay, the whole-turn undo — are one context-parameterized helper branching on this;
 * only the genuinely phase-specific bits (the capture-wave row vs. the one-Act economy)
 * differ inside.
 */
type BoardCtx = "deployment" | "battle";

/**
 * The mission driver (M6 phase loop, M7-framed): plays **one combat node** of the
 * run the {@link "./OverworldScene"} hands it. It owns no rules — the
 * {@link RunLoop} (already positioned at the chosen node) stages the encounter and
 * applies Upkeep/recovery/rewards/mortality. **Since M8 (D35)** the pre-fight camp
 * lives on the unified overworld camp ({@link "./OverworldScene"}); this scene runs
 * the silent Upkeep/RP bookkeeping then walks **Deployment → Battle → Resolution**,
 * and **returns to the overworld** so the player can pick the next node; the
 * overworld owns the run-end / run-complete terminals. The run + loop are passed in
 * (and back) so map position persists.
 */
export class BattleScene extends Phaser.Scene {
  private run!: RunState;
  private loop!: RunLoop;
  /** The owning guild + caravan (M9) — threaded back to the overworld/hall. */
  private guild?: RunHandoff["guild"];
  private caravanId?: string;
  /** A scene key to return to instead of the overworld (editor soft-play → `"EditorScene"`). */
  private returnTo?: string;
  private grid!: TileGrid;
  private battle!: Battle;

  private phase: "deployment" | "battle" | "resolution" = "deployment";

  // Board rendering (rebuilt each encounter).
  private gridGfx?: Phaser.GameObjects.Graphics;
  private safeZoneGfx?: Phaser.GameObjects.Graphics;
  private highlight!: Phaser.GameObjects.Graphics;
  /** Move-range / attack / valid-target preview, painted on the player's turn. */
  private preview!: Phaser.GameObjects.Graphics;
  /** The danger-zone overlay (toggle with T) and whether it's on. */
  private threatGfx!: Phaser.GameObjects.Graphics;
  private showThreat = false;
  /** The persistent tarpit-aura ring (Heavy Knight) — drawn in both Deployment and Battle (D64). */
  private auraGfx!: Phaser.GameObjects.Graphics;
  private boardObjects: Phaser.GameObjects.GameObject[] = [];
  /** Shared board geometry + grid/tile drawing (the converged combat presentation). */
  private view!: CombatView;

  // Persistent HUD.
  private titleText!: Phaser.GameObjects.Text;
  /** The objectives check-list box (far-left, under the title) — rebuilt each refresh. */
  private objectiveObjects: Phaser.GameObjects.GameObject[] = [];
  private orderText!: Phaser.GameObjects.Text;
  /** Active-unit focus card (left, the decision zone) + the peripheral situation card. */
  private focusCard!: MiniCard;
  /**
   * The top-right **situation card** (#131) — a Camp ↔ Intel toggle (D-feel). It shows the run's
   * **camp** economy (morale / purse / storage) or the encounter **intel** (foes / tier / shape /
   * types), flipped by the two tabs over the card. Defaults per phase: **Intel** in deployment
   * (it informs placement), **Camp** in battle (the foes are on the board by then). Owns its
   * MiniCard + tabs + view state; the scene hands it a fresh {@link SituationCtx} each refresh.
   */
  private situationCard!: SituationCard;
  /** The active Camp/Intel view — owned by {@link situationCard}; exposed for the e2e harness. */
  get cardView(): CardView {
    return this.situationCard.view;
  }
  /** The Camp/Intel tab chips — owned by {@link situationCard}; exposed for the e2e harness. */
  get cardTabs(): SituationCard["tabs"] {
    return this.situationCard.tabs;
  }
  /**
   * The docked **preview card** — the "before you commit" read (docked just under the
   * focus card): the armed-ability forecast (D64), or, on hover, the move-tile (cost +
   * tiles left), the enemy (deal + hits-back), or the deploy-tile (capture risk).
   */
  private previewCtl!: PreviewCardController;
  /** The docked preview MiniCard — owned by {@link previewCtl}; exposed for the e2e harness
   *  (`s.previewCard`), which reads its `.visible`. */
  get previewCard(): MiniCard {
    return this.previewCtl.card;
  }
  /** Initiative rail collapse (D-UX): show the soonest few, chevron to reveal the rest. */
  private static readonly RAIL_COLLAPSED = 3;
  private railExpanded = false;
  private railChevron?: Phaser.GameObjects.Text;
  /** The combat-log collapse toggle (centre-bottom): a chevron that shows/hides the feed. */
  private logCollapsed = false;
  private logChevron?: Phaser.GameObjects.Text;
  private hintPanel!: HintPanel;
  /** The always-on board colour key (safe/danger washes), set per phase. */
  private legendStrip!: LegendStrip;
  private lastHint = "";
  /** The bottom-left command menu (#131): the two stacked verb/turn-control boxes + the
   *  docked green primary. Spec-builders hand it {@link ActionSpec}[]; it owns the layout. */
  private menu!: CommandMenu;
  /** The green End Turn / Advance Clock primary — owned by {@link menu}; exposed for the
   *  screenshot/e2e harness (`s.primary`), which reads its label/position. */
  get primary(): Button {
    return this.menu.primary;
  }
  /** The command menu's live buttons — owned by {@link menu}; exposed for the e2e harness
   *  (`s.actionButtons`), which reads the rendered verb labels. */
  get actionButtons(): Phaser.GameObjects.GameObject[] {
    return this.menu.buttons;
  }
  private overlay: Phaser.GameObjects.GameObject[] = [];
  /** The toggleable Legend & Keys panel (L) — empty when hidden. */
  private legend: Phaser.GameObjects.GameObject[] = [];

  // Deployment state (D11): the active unit + a seeded roll stream for the net.
  private deployActor: Unit | null = null;
  private deployRng!: Rng;
  // D63 — the closing net: an advancing enemy danger front, a deployment-phase CT
  // clock that interleaves player turns with the front's, and the dug-in stance set.
  private dangerZoneGfx?: Phaser.GameObjects.Graphics;
  /** The extraction exit span tint (D97) — the "escape route" the freed prisoners walk to. */
  private exitZoneGfx?: Phaser.GameObjects.Graphics;
  /** The party's campfire (safe ground) and the enemy danger source (D63). */
  private campfire!: DeploySource;
  private front!: DeployFront;
  /** On-board source markers (campfire + enemy), cleared when battle begins. */
  private deployMarkers: Phaser.GameObjects.GameObject[] = [];
  /** Lock glyphs over cuffed captives (D90) — a state-driven layer, redrawn on rescue/boundary. */
  private captiveMarkers: Phaser.GameObjects.GameObject[] = [];
  /** Lock/bar glyphs over each locked interactable gate (D103) — redrawn on gateOpened + board setup. */
  private gateMarkers: Phaser.GameObjects.GameObject[] = [];
  /** Lever glyphs over each pull-switch (D103) — static, drawn at board setup. */
  private leverMarkers: Phaser.GameObjects.GameObject[] = [];
  /** What the active deploy unit has done this turn — drives the End-Turn CT spend. */
  private deployMoved = false;
  private deployActed = false;
  /**
   * A dug-in unit's turn opens to a minimal **Take Action / End Turn** menu (it chose to sit
   * out the maneuver). This flag, set by **Take Action**, reveals the unit's full deploy row
   * for the turn without yet breaking the stance — the dig-in capture benefit still holds
   * until it actually moves or commits an act (the status-effect trigger). Reset per turn.
   */
  private deployReveal = false;
  // D12 — concealed enemy traps: a seeded spot-roll stream.
  private spotRng!: Rng;
  /** The board trap-marker layer (#131): owns the enemy + player marker maps + the id counter. */
  private trapLayer!: TrapMarkerLayer;
  private intel?: IntelReport;

  // Battle interaction.
  private waitingFor: Unit | null = null;
  private armedSkill: SkillDef | null = null;
  /**
   * Free-move turn (D60): the active unit spends a **movement budget** tile-by-tile
   * across as many clicks as it likes, and its one **Act** (attack / skill) can fall
   * anywhere in that sequence — move, strike, move again. The turn ends only when the
   * player presses **End Turn** (or auto-ends once budget *and* Act are both spent).
   */
  /**
   * Movement still in the budget this turn; 0 once spent or Immobilized. The **one**
   * budget for both phases now (D-feel consolidation): a deploy turn and a battle turn
   * both step tile-by-tile against it, charging the **weighted** reach cost of each leg.
   */
  private moveBudget = 0;
  /** True once the unit has used its single Act this turn (attack / skill / verb). */
  private acted = false;
  /** Whether that Act costs the full Act CT (a `spend: "move"` skill does not). */
  private actCharged = false;
  /** True if the unit has stepped at all this turn (drives the end-turn CT spend). */
  private movedThisTurn = false;
  /** A sprung trap locks the turn's movement: no take-back once it's cost HP. */
  private turnLocked = false;
  /** The reachable destinations for the unit's *remaining* budget (path + cost each). */
  private reach: ReturnType<typeof reachableTiles> = [];
  /** `reach` keyed by tile for O(1) click/hover lookup (`"col,row"`). */
  private reachByKey = new Map<string, ReturnType<typeof reachableTiles>[number]>();
  /** The tile under the cursor whose route is lit (FE path read), or null. */
  private hoverTile: GridCoord | null = null;
  /** The enemy under the cursor (Battle) — drives the attack preview (deal / hits-back). */
  private hoverFoe: Unit | null = null;
  /** The walkable tile under the cursor (Deployment) — drives the capture-risk preview. */
  private deployHoverTile: GridCoord | null = null;
  /**
   * Deployment's reach **wash** layer (D-feel: parity with the battle turn). The reach
   * *data* is the shared {@link reachByKey} / {@link moveBudget} now — this is only its
   * own graphics layer, painted over the zone washes (under the markers) because the
   * deploy phase lays down zone washes the battle preview never has to draw past.
   */
  private deployReachGfx?: Phaser.GameObjects.Graphics;
  /**
   * Click-ahead (micro-movement): the latest plain board click made **while a step was
   * animating**. Replayed the instant that step finishes ({@link processQueuedClick}),
   * so rapid tile-by-tile clicking never drops an input. Cleared at every turn boundary.
   */
  private queuedTile: GridCoord | null = null;
  /** While a skill is armed: the hovered/aimed tile that drives its footprint + forecast box (D64). */
  private armedAim: GridCoord | null = null;
  /** Animation speed multiplier for moves (F cycles 1×/2×/4×) — playtest pacing (D55). */
  private turnSpeed = 1;
  /** A herb picked for the medic's med-heal, pending a target (D44 flow). */
  private pendingHerb: string | null = null;
  /** Primary-job levels at battle start — diffed for the level-up readout (D53). */
  private preBattleJobLevels = new Map<string, number>();
  private busy = false;
  private over = false;

  // M10 — theft (D30) + bribe→recruitment (D33).
  /** Live thief skims, keyed by the thief unit id (kill → recover, escape → lost). */
  private theftAttempts = new Map<string, TheftAttempt>();
  /** Total gold thieves got away with this battle (for the Resolution readout). */
  private goldStolen = 0;
  private goldRecovered = 0;
  /** Bribe targeting mode (the Noble's Influence verb), and pending permanent joins. */
  private bribeArmed = false;
  private pendingRecruits: Unit[] = [];

  constructor() {
    super("BattleScene");
  }

  /** Receive the run + loop (already positioned at the chosen combat node). */
  init(data: RunHandoff): void {
    this.run = data.run;
    this.loop = data.loop;
    this.guild = data.guild;
    this.caravanId = data.caravanId;
    this.returnTo = data.returnTo;
  }

  create(): void {
    // Repro capture (debug): the run state entering the battle — a restore re-stages this
    // node's encounter deterministically (mid-fight battle state isn't serialized, D-repro).
    captureRepro(this.run, { scene: "BattleScene", phase: "battle-staged", node: this.run.mapNodeId });
    this.view = new CombatView(this);
    // Enlarge the combat field for legibility (D-UX): bigger tiles + tokens (HP
    // bars, nameplates, status pips) so details stand out, especially in testing.
    // The procedural board is 8×6 and centred full-width, so it has room to grow.
    this.view.boardScale = BOARD_SCALE;
    this.view.reduceMotion = isScreenshotMode();
    // The trap-marker layer rides the scene's boardObjects teardown list (#131).
    this.trapLayer = new TrapMarkerLayer(this, this.view, this.boardObjects);
    // The campfire glow — a warm vignette over the board, beneath the tokens/HUD.
    addVignette(this);
    // Persistent UI.
    // Top strip = "the situation": a prominent heading (phase + whose turn) over a
    // Top-left = the **phase + turn** heading (whose turn it is + the deploy global state:
    // net reach / safe radius / kits). Left-aligned in the corner, off the now-clear top band.
    this.titleText = this.add.text(12, 16, "", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(10);
    // Objectives are now a stacked check-list box drawn far-left by refreshObjectives().
    // Right column = "timing/history": the turn-order rail (drawn by CombatView) and
    // its label move here, off the left so the left can host the focus card. The label
    // sits below the camp card (above the rail) so it isn't occluded by it.
    this.orderText = this.add.text(this.scale.width - 158, 122, "", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setDepth(10);
    // Left column = "you" (the decision zone): the active-unit focus card. Camp-state —
    // passive reference — is tucked top-right, clear below the Tips chip.
    this.focusCard = new MiniCard(this, 8, 82, { w: 150, hp: true }).hide();
    // The preview card — docked just under the focus card (repositioned per refresh so it
    // never overlaps a tall card). Surfaces the armed-ability forecast (D64) or, on hover,
    // the move-tile / enemy / deploy-tile outcome before you commit.
    this.previewCtl = new PreviewCardController(this, this.focusCard);
    // The top-right situation card (Camp ↔ Intel) — the component builds its MiniCard + the two
    // header tab chips; the scene supplies the live render context and the tab-hover hint sink.
    this.situationCard = new SituationCard(this, this.scale.width - 158, 42, 150, () => this.situationCtx(), (s) => this.setHint(s));
    this.hintPanel = new HintPanel(this);
    // The persistent board colour key — the same component carries across phases, re-keyed in
    // enterDeploy / startBattle so the wash language is always legible. Docked bottom, just right
    // of the command box (its backing spans MENU_LEFT..MENU_LEFT+MENU_BW+2·MENU_PAD), so the
    // bottom-right column stays clear for the combat log + the Session-log chip that opens there.
    const legendX = MENU_LEFT + MENU_BW + 2 * MENU_PAD + 14;
    this.legendStrip = new LegendStrip(this, legendX, this.scale.height - 20);
    // The combat log feed sits centre-bottom (between the legend and the CT rail), its lines
    // stacking up from just above a collapse chevron. The chevron flips the whole feed on/off.
    const logX = 350, logHeaderY = this.scale.height - 14;
    this.view.setLogLayout(logX, logHeaderY - 16);
    this.logChevron = this.add
      .text(logX, logHeaderY, "▾  Log", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption })
      .setOrigin(0, 0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });
    this.logChevron.on(Phaser.Input.Events.POINTER_DOWN, () => this.toggleLog());
    this.logChevron.on(Phaser.Input.Events.POINTER_OVER, () => this.logChevron?.setColor(INK.bright));
    this.logChevron.on(Phaser.Input.Events.POINTER_OUT, () => this.logChevron?.setColor(INK.muted));
    this.threatGfx = this.add.graphics().setDepth(0.36);
    // The tarpit-aura ring (D64) sits just above the zone washes but below the move/
    // footprint preview, so a Heavy Knight's taxed tiles read in both phases.
    this.auraGfx = this.add.graphics().setDepth(0.38);
    this.preview = this.add.graphics().setDepth(0.4);
    this.highlight = this.add.graphics().setDepth(0.5);
    this.menu = new CommandMenu(this, this.hintPanel, () => this.lastHint, () => this.onPrimary());
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    // Hover routing (D60): light the path to the tile under the cursor as it moves.
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    // Keyboard shortcuts (D55 QoL): one handler routes every key — see onKey / the
    // Legend (L) for the full list. The harness sets __SHOT__ for headless captures.
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => this.onKey(e));

    // Soft-play only: a persistent "Exit Playtest" affordance so an author can bail back to the
    // editor at any phase (deploy/battle/resolution) without having to fight the level to a finish
    // — the whole point of a functional test is to iterate. Depth above every overlay/dimmer so it
    // stays clickable on the after-action screen too. Absent in the normal run flow.
    if (this.returnTo) this.buildExitButton();

    this.startCombatNode();
  }

  /** The dev-only top-center "Exit Playtest" button (soft-play, when {@link returnTo} is set). */
  private buildExitButton(): void {
    const btn = new Button(this, this.scale.width / 2, 18, {
      text: "✎ Exit Playtest",
      w: 132,
      h: 26,
      fill: COLOR.surfaceRaised,
      stroke: COLOR.gold,
      color: INK.bright,
      fontSize: FONT.caption,
      onClick: () => this.returnToOverworld(),
    });
    this.add.existing(btn).setDepth(40);
  }

  // --- Combat node lifecycle (one chosen mission) ---------------------------

  /**
   * Stage the chosen combat node: run the silent **Upkeep/RP/dying-clock**
   * bookkeeping (D3/D9/D15 — the pre-fight *camp actions* now live on the unified
   * overworld camp, D35), build the board for the node's seeded encounter, read
   * intel (D10), and go straight to **Deployment**. If a dying clock runs out and
   * wipes the party, return straight to the overworld's run-end.
   */
  private startCombatNode(): void {
    clearLayer(this.overlay);

    // Between-battle bookkeeping: pay Upkeep, bank RP, tick dying clocks (D9/D15).
    const camp = this.loop.camp();
    if (this.loop.isOver()) return this.returnToOverworld();

    // Stage the chosen node's seeded encounter and build the board.
    this.battle = this.loop.startEncounter();
    this.grid = this.battle.grid;
    // Wire the new bus's combat FX once, up front — so deployment trap springs float +
    // log like combat (the bus persists through both phases; battle won't double-fire).
    this.wireBattleFx();
    this.over = false;
    this.busy = false;
    this.waitingFor = null;
    this.armedSkill = null;
    this.deployActor = null;
    this.trapLayer.resetPlayer();
    this.pendingHerb = null;
    clearLayer(this.objectiveObjects);
    this.rebuildBoard();

    // Intel read (D10), then straight into Deployment.
    this.intel = this.loop.intel();
    this.situationCard.resetView("intel"); // a fresh node opens in deployment — lead the situation card with intel
    this.refreshSituationCard();
    const upkeepNote =
      camp.upkeep.underfunded.length > 0
        ? `Underfunded ${camp.upkeep.underfunded.join(" + ")} — morale took a hit.`
        : camp.upkeep.skipped.length > 0
          ? `Skipped ${camp.upkeep.skipped.join(" + ")} on purpose (gold freed; ${camp.upkeep.paid}g paid).`
          : `Upkeep paid (${camp.upkeep.paid}g).`;
    this.enterDeploy();
    this.setHint(`${upkeepNote} +${camp.rpAdded} RP banked. Deploy your party, then Start Battle.`);
  }

  private rebuildBoard(): void {
    clearLayer(this.boardObjects);
    this.view.clearUnits();
    this.gridGfx?.destroy();
    this.safeZoneGfx?.destroy();
    this.safeZoneGfx = undefined;
    this.dangerZoneGfx?.destroy();
    this.dangerZoneGfx = undefined;
    // Same lazy-create + stale-on-re-entry hazard as the zone graphics (D96): reset it here.
    this.exitZoneGfx?.destroy();
    this.exitZoneGfx = undefined;
    this.deployReachGfx?.destroy();
    this.deployReachGfx = undefined;
    // The CT-rail chevron is created lazily (`if (!this.railChevron)` in layoutRailChevron) and
    // cached in an instance field — but the field survives a scene shutdown while its Text is
    // destroyed. On a SECOND battle (e.g. E1 → snares) the stale handle's `setText` hit a null
    // texture and froze the deploy render. Reset it here (like the zone graphics) so each battle
    // recreates it fresh. (logChevron is recreated unconditionally in create(), so it's immune.)
    this.railChevron?.destroy();
    this.railChevron = undefined;
    clearLayer(this.deployMarkers);
    clearLayer(this.captiveMarkers);
    clearLayer(this.gateMarkers);
    clearLayer(this.leverMarkers);
    this.highlight.clear();
    this.view.clearPreview(this.preview);
    this.threatGfx.clear();

    // The shared board-centering (CombatView.centerOrigin) — the one formula, so a grid/tile
    // metric change reaches the editor too (the view owns the resulting origin).
    this.view.centerOrigin(this.grid.rows, this.scale.height, this.scale.width / 2);

    this.drawGrid();
    this.spawnUnits();
  }

  /**
   * Wire the combat-FX bus listeners once per encounter (D-feel: deployment ↔ combat
   * parity). `this.battle.bus` is fresh per `startEncounter`, so attaching here — before
   * Deployment runs — means a unit that springs a concealed trap *during deployment*
   * floats its damage and writes the combat log exactly as it would mid-battle, instead
   * of taking the hit silently. The same single attachment carries through the battle
   * phase (the bus persists), so combat reads identically and nothing double-fires. The
   * per-turn `turnStart` header is combat-only (deployment has no per-unit turn cadence
   * worth logging) and stays wired in {@link startBattle}.
   */
  private wireBattleFx(): void {
    // Player traps registered at placement announce their own spring (trapSprung); the
    // scene just animates the marker. Concealed *enemy* traps that spring in deployment
    // carry no player marker, so this no-ops for them (checkTrapSprings reveals those).
    this.battle.bus.on("trapSprung", ({ id }) => {
      const m = this.trapLayer.playerMarker(id);
      if (!m) return;
      m.setText(ICON.trapSprung.glyph).setColor(INK.disabled);
      this.tweens.add({ targets: m, scale: 1.8, duration: 140, yoyo: true });
    });
    // Floating combat text + impact scaling ride the rules' damage/heal bus, so they
    // cover every source (attacks, traps, charged skills) in **both** phases — parity.
    this.battle.bus.on("unitDamaged", ({ unit, amount, source }) => {
      this.view.noteDamage(unit.id, amount);
      this.view.floatDamage(unit, amount);
      this.view.logDamage(unit, amount, source);
    });
    this.battle.bus.on("unitHealed", ({ unit, amount, source }) => {
      if (amount > 0) this.view.floatText(unit, `+${amount}`, INK.success);
      this.view.logHeal(unit, amount, source);
    });
    this.battle.bus.on("unitDefeated", ({ unit }) => this.view.logDefeat(unit));
    // Standing-order moments (D84): the panic turn and the exit both announce
    // themselves — the token vanish rides the normal unit refresh (escaped units
    // aren't drawn), so the bus only narrates.
    this.battle.bus.on("orderChanged", ({ unit, order }) => {
      const stance = STANDING_ORDERS[order]?.stance;
      if (stance) this.view.logLine(`${unit.name} ${order === "flee" ? "panics — " : ""}${stance}`, INK.ember);
    });
    this.battle.bus.on("unitEscaped", ({ unit }) => {
      this.view.logLine(`${unit.name} escapes off the map!`, INK.ember);
      this.view.refreshUnits();
    });
    // The in-combat rescue Act (D52): freeing a bound unit — a captured ally, or a new
    // captive recruit (the L1 Cook) — announces itself here, so the event owns the reaction
    // (un-grey the token, flash, log the moment) rather than the call site. The post-win
    // auto-free is the resolution `rescued` tally, not this live event, so it doesn't fire.
    this.battle.bus.on("unitRescued", ({ unit, by }) => {
      this.tintCaptured(unit, false);
      this.flashHeal(unit);
      this.view.logRescue(unit, by);
      this.markCuffedCaptives(); // a freed captive drops its lock glyph (D90)
    });
    // A gate opened (D103): the tile is now walkable, so redraw the grid to drop its obstacle block,
    // remark the gates (the opened one loses its ▦), and narrate. Same reaction for a Thief's lockpick
    // and the automatic keyholder pop (the Warden's keys) — only the log line differs by `cause`.
    this.battle.bus.on("gateOpened", ({ by, cause }) => {
      this.drawGrid();
      this.markGates();
      const msg = cause === "keyholder"
        ? "The keys drop — a cell springs open!"
        : cause === "destroyed"
          ? `${by?.name ?? "A blow"} smashes the door open!`
          : cause === "lever"
            ? `${by?.name ?? "The lever"} throws the lever — the gate grinds open!`
            : `${by?.name ?? "The lockpick"} picks a cell open!`;
      this.view.logLine(msg, INK.gold);
    });
    // A lever slammed a gate shut (D103): the tile re-blocks, so redraw the grid + re-mark the gate.
    this.battle.bus.on("gateLocked", ({ by }) => {
      this.drawGrid();
      this.markGates();
      this.view.logLine(`${by?.name ?? "The lever"} throws the lever — the door slams shut!`, INK.gold);
    });
    // A destructible door took a hit but held (D103): refresh the HP readout + narrate the shudder.
    this.battle.bus.on("gateDamaged", ({ gate, by }) => {
      this.markGates(); // re-render the HP readout (hp already decremented on the gate)
      this.view.logLine(`${by?.name ?? "A blow"} batters the door — ${gate.hp}/${gate.maxHp} left`, INK.ember);
    });
    // The Noble's bribe (D30/D62): a swayed enemy turns coat — re-tint its token to the ally
    // palette here (a listener, like unitRescued), rather than the call site flipping `side`.
    this.battle.bus.on("unitSwayed", ({ unit }) => {
      const view = this.view.views.get(unit.id);
      view?.body.setFillStyle(COLOR.ally).setStrokeStyle(2, COLOR.allyEdge);
    });
    // Deploy → battle transition (D67): when the alarm trips (or the player commits), the
    // bus announces combat, and the render tears down the staging visuals — lift the D12
    // veil so the foe resolves into view, and retire the deploy zone/reach overlays + the
    // source markers. A first-class moment (other "opening of battle" effects can hook it)
    // rather than buried in startBattle's imperative cleanup.
    this.battle.bus.on("battleBegan", () => {
      this.view.concealEnemies = false;
      this.view.refreshUnits();
      this.safeZoneGfx?.clear();
      this.dangerZoneGfx?.clear();
      // The exit route persists into battle (the escort is mid-fight) — repaint it (D97).
      this.drawExitZone();
      this.deployReachGfx?.clear();
      clearLayer(this.deployMarkers);
      this.markCuffedCaptives(); // a still-cuffed captive keeps its lock into the fight (D90)
    });
    // The front's net-closing turn (D67 W3): the deploy loop emits `frontTurn` when the CT
    // clock hands the tempo source its turn, and the capture wave resolves here as a reaction
    // — so the front's turn is a first-class slot on the clock, not a branch wired into the
    // loop. Harmless in combat (never emitted there — the front is detached at the boundary).
    this.battle.bus.on("frontTurn", () => this.resolveFrontWave());
  }

  // --- Phase: Deployment -----------------------------------------------------

  private enterDeploy(): void {
    this.phase = "deployment";
    this.battle.enterDeploy(); // the Battle is now in the pre-combat phase (D67)
    // The foe is pre-positioned but unseen during staging (D12) — veil enemy tokens
    // now; startBattle lifts it. Refresh re-applies the veil after spawnUnits.
    this.view.concealEnemies = true;
    this.view.refreshUnits();
    this.legendStrip.setItems(this.hasExtraction() ? [...DEPLOY_LEGEND, EXIT_LEGEND_ITEM] : DEPLOY_LEGEND);
    // Deployment's RNG draws from the one encounter seed the Battle now owns (D67), via its
    // label-keyed stream seam — the scene no longer reaches into run.seed for its rolls.
    // (battle seed == run.seed, so the streams are byte-identical to the prior wiring.)
    this.deployRng = this.battle.stream(Labels.deploy());
    this.spotRng = this.battle.stream(Labels.trapSpot());
    this.trapLayer.reset();
    // Deploy verbs flow through the one interpreter now (D63): wire the run stash so
    // Battle's placeTrap action can spend kits, undoably, on the shared log.
    this.battle.setStash(this.run.inventory);
    // D63 — the closing net: the enemy is a single danger front that marches in from
    // its edge, with a Speed leaning toward the camp's fastest scout. Player units and
    // the front share one deployment CT clock, so a quick party earns more positioning
    // turns between net-closings. (Dig-in is unit state now, reset at staging.)
    const enemies = this.battle.units.filter((u) => u.side === "enemy");
    // The campfire's protected (capture-immune) core comes from party presence and is
    // capped to the board width (D-feel) — a small map keeps a tight core. The morale/
    // intel deploy edge (D8/D10) now trims the *neutral* capture rate instead of widening
    // the immune zone (see deployMods().exposureMultiplier, threaded into the net rolls).
    this.campfire = createCampfire(this.grid, this.battle.units);
    this.front = createFront(this.grid, enemies);
    // Deployment runs on the Battle's **own** CT clock (D67 W2) — no parallel instance.
    // Configure it for the phase: narrow turn-taking to active players (the pre-positioned
    // enemies freeze off the same clock) and attach the front as a strict-lead tempo source.
    // Seeded per-unit (a warmer party acts first); the front starts cold. The combat boundary
    // (beginBattle → resetForCombat) sheds this config and re-seeds for the fight.
    configureDeployClock(this.battle.clock, this.front);
    this.battle.clock.seedFlat();
    this.drawZones();
    drawSourceMarkers(this, this.view, this.deployMarkers, this.campfire, this.front);
    this.markCuffedCaptives(); // lock glyphs over any cuffed captives (D90)
    this.markGates(); // lock/bar glyphs over any locked interactable gates (D103)
    this.markLevers(); // lever glyphs over any pull-switches (D103)
    // Trap-field (D12): enemy hazards are live across *both* phases, so the party's
    // opening Awareness scan happens here — at the deploy line, not at combat start.
    // Spotted traps draw now, so positioning is informed; the rest are sensed as units
    // advance (the per-step read) or via a deliberate Search.
    if (hiddenTraps(this.battle.entities).length > 0) {
      for (const u of this.battle.units) if (u.side === "player" && u.alive) revealTrapsNear(u, this.battle.entities, this.spotRng);
      this.redrawTrapMarkers();
    }
    this.deployNextActor(); // step to the first actor (a player gets the head start)
  }

  // --- Phase: Deployment — the turn-based closing net (D63) -------------------

  /**
   * Step the deployment clock by one actor — a player unit's turn, or the front's.
   * Nothing here happens on its own: a player ends their turn and presses Advance
   * Clock to step the net, so the board never changes without an explicit input.
   */
  private deployNextActor(): void {
    if (this.over || this.phase !== "deployment" || this.busy) return;
    const turn = this.battle.clock.nextTurn();
    if (turn.kind === "unit") this.beginDeployTurn(turn.unit);
    // "tempo" (the front leads) or "idle" (never — the front always charges): announce the
    // front's turn on the bus; the capture-wave listener (resolveFrontWave) resolves it.
    else this.battle.bus.emit("frontTurn", {});
  }

  /** Open one player unit's deployment turn: it may move, dig in, or set a trap. */
  private beginDeployTurn(unit: Unit): void {
    this.view.setActiveUnit(unit);
    this.deployMoved = false;
    this.deployActed = false;
    this.deployReveal = false;
    this.moveBudget = moveBudget(unit);
    this.deployHoverTile = null;
    this.queuedTile = null;
    // Arm the shared action-log undo for the deploy turn (D63) — each move/dig-in/
    // trap becomes undoable back to the turn's start, exactly like a combat turn.
    this.battle.beginUndo();
    // The active unit looks around as it steps up — a passive Awareness scan may spot
    // nearby traps (D12 parity with the combat turn-open, the same shared helper). Reveal
    // *before* the buttons render so a freshly-spotted adjacent trap surfaces its Disarm verb.
    const spotted = this.scanTrapsOnTurnOpen(unit);
    this.setPrimary("End Turn"); // before the row builds, so the half-width pair labels correctly
    this.selectDeployActor(unit);
    this.recomputeReach(unit); // light the reachable tiles for this turn's budget (shared with battle)
    this.drawDeployReach();
    const trapsAfield = hiddenTraps(this.battle.entities).length > 0 || this.trapLayer.enemyCount > 0;
    if (unit.dugIn) {
      // The unit chose to sit this out: a minimal menu. Moving (a map click) still re-engages
      // it directly — Take Action is the no-move way back in.
      this.setHint(`${unit.name} is dug in (lower capture risk). Click a tile to move (re-engaging), press Take Action to act in place, or End Turn (Space) to stay hunkered.`);
    } else {
      this.setHint(
        `${unit.name}'s turn — click a tile to reposition, Dig In, or place a trap, then End Turn (Space). ` +
          (spotted > 0 ? `Spots ${spotted} hidden trap${spotted > 1 ? "s" : ""} (${ICON.trapArmed.glyph})! ` : "") +
          (trapsAfield ? `Search to scan further, or a trapper can Disarm. ` : "") +
          `The enemy's reach is ${this.front.radius} step${this.front.radius === 1 ? "" : "s"} and growing.`,
      );
    }
  }

  /** Between deploy turns the clock rests on the player — Advance Clock steps it. */
  private enterDeployIdle(hint: string): void {
    this.deployActor = null;
    this.queuedTile = null;
    this.deployHoverTile = null;
    this.highlightTile(null);
    this.drawDeployReach(); // no actor between turns → clears the reach wash
    this.setPrimary("Advance Clock");
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint(hint);
  }

  /**
   * The capture wave — the `frontTurn` bus listener (D67 W3, was the inline `runFrontTurn`).
   * The net advances one column, then rolls capture for every unit it has swallowed. The
   * first capture raises the alarm and battle begins; if the net overruns the camp's home
   * edge with nobody caught, battle begins anyway. Otherwise the clock rests on the player
   * until the next Advance. Reached only via the bus (emitted when the CT clock hands the
   * tempo source its turn), so the front's turn is a hookable moment, not a hardcoded branch.
   */
  private resolveFrontWave(): void {
    // resolveFrontTurn reads each unit's dugIn stance by default (D63); the morale/intel
    // deploy edge rides in as the neutral-capture multiplier (D8/D10).
    const out = resolveFrontTurn(this.front, this.campfire, this.battle.units, this.deployRng, {
      exposureMultiplier: this.deployMods().exposureMultiplier,
    });
    this.battle.clock.spendTempo();
    this.deployActor = null;
    this.clearActionButtons();
    this.drawZones();
    this.highlightTile(null);

    // The branch (catch → alarm / overrun / continue) is a pure decision now (D63
    // Phase B); the scene just renders the chosen stage.
    const stage = frontTurnStage(out, this.grid, this.campfire, this.front);
    if (stage.kind === "capture") {
      const caught = out.captured!;
      // The net's turn is the deploy "enemy turn": bind the catch through the one
      // interpreter (logged), mirroring how a combat enemy turn flows through apply.
      this.battle.capture(caught);
      this.dropNet(caught);
      this.placeView(caught);
      this.tintCaptured(caught, true);
      this.busy = true;
      this.setHint(`${caught.name} was snared as the danger closed in — the alarm goes up! Battle begins.`);
      this.time.delayedCall(950, () => {
        this.busy = false;
        this.startBattle();
      });
      return;
    }
    if (stage.kind === "overrun") {
      this.busy = true;
      // Either the net reached the protected core (a breach — nobody taken) or it
      // swallowed the last safe tile; both start the battle with the party where it stands.
      this.setHint(out.breached
        ? "The net reaches your camp — the alarm goes up, battle begins!"
        : "The enemy has overrun the camp — battle begins!");
      this.time.delayedCall(800, () => {
        this.busy = false;
        this.startBattle();
      });
      return;
    }
    this.enterDeployIdle(`The enemy's reach grows to ${this.front.radius} steps. Advance Clock (Space) to continue, or Start Battle.`);
  }

  /** End the active unit's deployment turn and spend its CT (no auto-advance). */
  private endDeployTurn(unit: Unit): void {
    this.view.setActiveUnit(null);
    this.battle.endUndo(); // the deploy turn commits — no take-back across the boundary
    this.battle.clock.spend(unit, { moved: this.deployMoved, acted: this.deployActed });
    this.enterDeployIdle(`${unit.name}'s turn ends — Advance Clock (Space) to step the net, or Start Battle.`);
  }

  /** Destroy board markers for player traps no longer registered (after an undo). */
  private syncPlayerTrapMarkers(): void {
    this.trapLayer.syncPlayer(this.battle.entities);
  }

  /**
   * Take Action — re-engage a unit that began its turn dug in: reveal its full deploy row for
   * the turn. Doesn't break the stance itself; the dig-in capture benefit holds until the unit
   * actually moves (clears it in `moveUnit`) or commits an act (cleared in the act seams), so a
   * reveal that ends in "End Turn" leaves the unit hunkered.
   */
  private takeAction(actor: Unit): void {
    if (this.busy || actor.captured || this.deployActor !== actor) return;
    this.deployReveal = true;
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint(`${actor.name} re-engages — move, place a trap, or use a skill (the dug-in benefit holds until it does). Or End Turn (Space) to stay hunkered.`);
  }

  /** Dig In (D63): hunker on this tile for a sharply reduced capture chance. */
  private digIn(): void {
    const actor = this.deployActor;
    if (!actor || actor.captured || this.busy || this.deployActed) return;
    this.battle.digIn(actor); // logged + undoable through the one interpreter (D63)
    this.deployActed = true;
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint(`${actor.name} digs in — braced low against the net. End Turn (Space) to advance it.`);
  }

  private moraleMods() {
    return moraleModifiers(moraleTier(this.run.camp.morale));
  }

  /**
   * Deploy modifiers = morale (D8) folded with the intel edge (D10). The additive/
   * multiplicative fold now lives in core {@link deployModifiers} (tested); this is the
   * scene's pass-through, reading the run's current encounter.
   */
  private deployMods() {
    return deployModifiers(this.run, currentEncounter(this.run));
  }

  private selectDeployActor(unit: Unit | null): void {
    // Zones are now party-wide (campfire + enemy source), so switching units only
    // moves the cursor — the green/red map no longer redraws per unit (D63).
    this.deployActor = unit;
    this.highlightTile(unit ? unit.pos : null);
    this.refreshDeployButtons();
    this.refreshDeployStatus();
  }

  private refreshDeployButtons(): void {
    const actor = this.deployActor;
    const specs: ActionSpec[] = [];
    // Turn-control box (pure decision, D63/D67): Undo + Start Battle + the Advance Clock /
    // End Turn primary, kept apart from the unit's verbs. During a unit's turn, Undo is
    // **persistent** beside End Turn (greyed/inert until there's something to take back);
    // between turns there's no active unit to undo, so it's omitted and Advance Clock stays
    // full-width.
    const ids = deployActions({ hasActor: !!actor, captured: !!actor?.captured, canUndo: this.battle.canUndo() });
    const canUndo = ids.includes("undo");
    const undo: ActionSpec | undefined = actor
      ? {
          text: "Undo",
          description: canUndo
            ? "Take back everything this unit did this deploy turn — moves, dig-in, traps (kit refunded) — back to where it started (Esc)."
            : "Nothing to take back yet — move, dig in, or place a trap, then Undo returns the unit to where it started.",
          enabled: canUndo,
          onClick: () => this.undoTurn(actor, "deployment"),
        }
      : undefined;
    // A unit that **began** the turn dug in (vs. one that just dug in this turn — `deployActed`)
    // sits out the maneuver: a minimal **Take Action** verb stands in for the full row, so the
    // player sees the unit was intentionally taken out of action. Take Action reveals the row
    // for this turn (`deployReveal`) without breaking the stance yet. Moving (a map click) still
    // re-engages it directly — the reach stays lit.
    const hunkered = !!actor && !!actor.dugIn && !actor.captured && !this.deployActed && !this.deployReveal;
    if (hunkered) {
      specs.push({
        text: "Take Action",
        description: "Stand this unit up to act this turn — its full options return. The dug-in capture benefit holds until it actually moves or acts.",
        onClick: () => this.takeAction(actor!),
      });
    }
    // The ability buttons are the **same data-driven projection as combat** (D67): the unit's
    // pre-combat skills + the universal Dig In / Defend, from availableSkills — so a Set-Trap
    // skill surfaces because it's pre-combat *data*, not via a hand-computed `canTrap`.
    if (actor && !actor.captured && !this.deployActed && !hunkered) {
      // Offensive skills are board skills now (D67 W7) — not banned pre-combat, just idle
      // without a target. Surface them only when a foe is actually **engageable** (un-concealed
      // — a keep-assault stages defenders that way); the default staging conceals the enemy
      // roster, so this stays empty and the deploy row reads exactly as before.
      const canEngage = this.battle.units.some((u) => u.alive && !u.concealed && u.side !== actor.side);
      for (const skill of availableSkills(actor, "pre-combat")) {
        if (skill.target === "enemy" && !canEngage) continue;
        const text = skill.effect.kind === "placeTrap" ? "Place Trap Here" : skill.name;
        specs.push({ text, description: skill.description, onClick: () => this.onDeploySkillButton(actor, skill) });
      }
      this.pushTrapVerbs(specs, actor, "deployment"); // Search / Disarm — the shared trap-field verbs
      this.pushRescueVerbs(specs, actor, "deployment"); // Pick Lock — free an adjacent cuffed captive (D90)
      this.pushGateVerbs(specs, actor, "deployment"); // Pick Cell — lockpick an adjacent locked gate (D103)
    }
    // Start Battle is a turn-control (commit early at any point), so it sits in the control
    // box (a full-width row above the Undo/primary pair) — not among the unit's verbs.
    const controls: ActionSpec[] = [{
      text: "Start Battle",
      description: "Commit now — begin the fight with the party where it stands.",
      onClick: () => { if (!this.busy) this.startBattle(); },
    }];
    this.layoutActionMenu(specs, { undo, controls });
  }

  /**
   * Push the trap-field verbs (D12) onto an action row when concealed traps are afield:
   * **Search** scans the ground ahead, and a trap-trained unit **Disarms** a spotted,
   * adjacent one to pocket its kit — both spend the unit's Act. Shared by the deploy row
   * and the combat row (D-feel: one shared scene path); only the phase context differs.
   */
  private pushTrapVerbs(specs: ActionSpec[], actor: Unit, ctx: BoardCtx): void {
    const noun = ctx === "deployment" ? "act" : "action"; // the deploy row says "act"; combat "action"
    if (hiddenTraps(this.battle.entities).length > 0) {
      specs.push({
        text: "Search",
        description: `Spend this unit's ${noun} scanning the ground ahead for concealed traps (a wider, better look).`,
        onClick: () => this.doSearch(actor, ctx),
      });
    }
    const adjTrap = this.adjacentRevealedTrap(actor);
    if (adjTrap && canDisarm(actor)) {
      specs.push({
        text: "Disarm trap",
        description: "Disarm the adjacent spotted trap and pocket its kit (a trap-trained unit only).",
        onClick: () => this.doDisarm(actor, adjTrap.id, ctx),
      });
    }
  }

  /**
   * Push the **Pick Lock** verb (D90) when this unit can free an adjacent **cuffed** captive —
   * the Thief's infiltration payoff. Only a lockpick holder can spring a `lockpick`-gated
   * captive, so the verb is surfaced solely when the core gate would pass ({@link canRelease}):
   * a non-lockpick unit never sees a dead button, and the freed body carries into the fight.
   * (Ordinary `reach` captives — the L1 Cook — keep their click-to-free path; this is the new
   * deploy-phase affordance the cuffed cell needs.)
   */
  private pushRescueVerbs(specs: ActionSpec[], actor: Unit, ctx: BoardCtx): void {
    const cuffed = this.battle.units.find(
      (u) =>
        u.side === actor.side &&
        u.captured &&
        u.release?.kind === "lockpick" &&
        isAdjacent(actor.pos, u.pos) &&
        canRelease(u, actor),
    );
    if (!cuffed) return;
    const noun = ctx === "deployment" ? "act" : "action";
    specs.push({
      text: "Pick Lock",
      description: `Spring ${cuffed.name}'s shackles — free them to fight at your side (spends this unit's ${noun}).`,
      onClick: () => this.doRescue(actor, cuffed, ctx),
    });
  }

  /**
   * Free an adjacent captive as this unit's Act — the "Pick Lock" handler (D90), shared across
   * both phases via {@link commitFieldAct}. The core `rescue` action is the gate ({@link
   * canRelease}), so a cuffed captive only yields to a lockpick unit; the freed body carries
   * into combat. `unitRescued` (the bus listener) owns the re-tint, the pop, the lock-glyph
   * teardown, and the log line.
   */
  private doRescue(actor: Unit, captive: Unit, ctx: BoardCtx): void {
    if (!this.canFieldAct(actor, ctx)) return;
    if (!isAdjacent(actor.pos, captive.pos)) {
      return this.setHint(`Move ${actor.name} next to ${captive.name} to pick the lock.`);
    }
    this.battle.rescue(captive, actor);
    const tail = ctx === "deployment" ? " Reposition or End Turn." : "";
    this.commitFieldAct(actor, ctx, `${actor.name} picks the lock — ${captive.name} is freed to fight!${tail}`);
  }

  /**
   * Push the **Pick Cell** verb (D103) when this unit can lockpick an adjacent locked gate — the
   * Thief's cell-open Act. Surfaced only when the core gate would pass ({@link canLockpickGate}:
   * locked + a lockpick condition + adjacent + Expert Lockpick), so a non-lockpick unit never sees a
   * dead button. Mirrors {@link pushRescueVerbs}; shared across deployment + combat.
   */
  private pushGateVerbs(specs: ActionSpec[], actor: Unit, ctx: BoardCtx): void {
    const noun = ctx === "deployment" ? "act" : "action";
    // Pick Cell — a Thief lockpicks an adjacent locked cell.
    const pickable = this.battle.gates.find((g) => canLockpickGate(g, actor));
    if (pickable) {
      specs.push({
        text: "Pick Cell",
        description: `Pick the lock on the adjacent cell — the gate swings open (spends this unit's ${noun}).`,
        onClick: () => this.doOpenGate(actor, pickable, ctx),
      });
    }
    // Break Gate — any unit batters a destructible door in reach (the guards busting it down, D103 Phase 3).
    const breakable = this.battle.gates.find((g) => canAttackGate(g, actor));
    if (breakable) {
      specs.push({
        text: "Break Gate",
        description: `Batter the door (${breakable.hp}/${breakable.maxHp} left) — chip its durability by this unit's attack; it breaks open at 0 (spends this unit's ${noun}).`,
        onClick: () => this.doBreakGate(actor, breakable, ctx),
      });
    }
    // Pull Lever — throw an adjacent control-room switch to seal/open its gate (D103 Phase 3).
    const lever = this.battle.levers.find((l) => canPullLever(l, actor));
    if (lever) {
      specs.push({
        text: "Pull Lever",
        description: `Throw the switch — slam its door shut (seal the guards out) or grind it open (spends this unit's ${noun}).`,
        onClick: () => this.doPullLever(actor, lever, ctx),
      });
    }
  }

  /**
   * Lockpick an adjacent gate as this unit's Act — the "Pick Cell" handler (D103), shared across both
   * phases via {@link commitFieldAct}. The core {@link canLockpickGate} is the gate; `gateOpened` (the
   * bus listener) owns the grid redraw, the marker teardown, and the log line.
   */
  private doOpenGate(actor: Unit, gate: Gate, ctx: BoardCtx): void {
    if (!this.canFieldAct(actor, ctx)) return;
    if (!canLockpickGate(gate, actor)) {
      return this.setHint(`Move ${actor.name} next to the cell to pick its lock.`);
    }
    this.battle.openGate(gate, actor);
    const tail = ctx === "deployment" ? " Reposition or End Turn." : "";
    this.commitFieldAct(actor, ctx, `${actor.name} picks the cell open!${tail}`);
  }

  /**
   * Batter a destructible gate as this unit's Act — the "Break Gate" handler (D103). One hit chips the
   * door's durability; it breaks open at 0. `gateDamaged` / `gateOpened` (the bus listeners) own the
   * flash, the HP-readout refresh, the redraw, and the log line.
   */
  private doBreakGate(actor: Unit, gate: Gate, ctx: BoardCtx): void {
    if (!this.canFieldAct(actor, ctx)) return;
    if (!canAttackGate(gate, actor)) {
      return this.setHint(`Move ${actor.name} into range of the door to break it.`);
    }
    this.battle.attackGate(gate, actor);
    const tail = ctx === "deployment" ? " Reposition or End Turn." : "";
    this.commitFieldAct(actor, ctx, `${actor.name} strikes the door!${tail}`);
  }

  /**
   * Throw an adjacent lever as this unit's Act — the "Pull Lever" handler (D103). Toggles the lever's
   * target gates; `gateLocked` / `gateOpened` (the bus listeners) own the grid redraw, the markers, and
   * the log line.
   */
  private doPullLever(actor: Unit, lever: Lever, ctx: BoardCtx): void {
    if (!this.canFieldAct(actor, ctx)) return;
    if (!canPullLever(lever, actor)) {
      return this.setHint(`Move ${actor.name} next to the lever to pull it.`);
    }
    this.battle.pullLever(lever, actor);
    const tail = ctx === "deployment" ? " Reposition or End Turn." : "";
    this.commitFieldAct(actor, ctx, `${actor.name} throws the lever!${tail}`);
  }

  /**
   * Draw a lock glyph over each **cuffed** captive (D90) — a bound ally whose release needs the
   * Expert Lockpick. Its own state-driven layer ({@link captiveMarkers}), redrawn on the
   * rescue/boundary events, so a freed (or ordinary `reach`) captive carries no lock. Reads
   * from live unit state, so it is always the truth of who is still cuffed.
   */
  private markCuffedCaptives(): void {
    clearLayer(this.captiveMarkers);
    for (const u of this.battle.units) {
      if (!u.captured || u.release?.kind !== "lockpick") continue;
      const { x, y } = this.tileToWorld(u.pos);
      this.captiveMarkers.push(
        placeIcon(this, x, y - this.view.halfH() * 0.6, "locked", { size: FONT.body }).setDepth(5),
      );
    }
  }

  /**
   * Draw a bar/lock glyph over each **locked** gate (D103) — a state-driven layer, redrawn on the
   * board setup + every gateOpened event, so an opened cell drops its marker. The gate tile also
   * reads as a solid (it's non-walkable while locked, so {@link "../combat-view".CombatView.drawGrid}
   * raises an obstacle block there); this floats the ▦ over it so it reads as a *cell*, not a wall.
   */
  private markGates(): void {
    clearLayer(this.gateMarkers);
    for (const g of this.battle.gates) {
      // A smashed door (D106) leaves a passable remnant on its tile — a low, muted floor marker (not a
      // block, and never the ▦ lock/HP readout). Rendered before the locked-only skip below.
      if (g.broken) {
        const { x, y } = this.tileToWorld(g.pos);
        this.gateMarkers.push(placeIcon(this, x, y, "gateRemnant", { size: FONT.body }).setDepth(2));
        continue;
      }
      if (!g.locked) continue;
      const { x, y } = this.tileToWorld(g.pos);
      const top = y - this.view.halfH() * 0.9;
      this.gateMarkers.push(placeIcon(this, x, top, "gate", { size: FONT.body }).setDepth(5));
      // A destructible door shows its remaining durability under the ▦ (the "batter it down" readout).
      if (g.hp !== undefined) {
        this.gateMarkers.push(
          this.add.text(x, top + 12, `${g.hp}/${g.maxHp}`, { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.micro, fontStyle: WEIGHT.bold }).setOrigin(0.5).setDepth(5),
        );
      }
    }
  }

  /** Draw a lever glyph over each pull-switch (D103) — a static layer (levers don't move; their gates do). */
  private markLevers(): void {
    clearLayer(this.leverMarkers);
    for (const l of this.battle.levers) {
      const { x, y } = this.tileToWorld(l.pos);
      this.leverMarkers.push(placeIcon(this, x, y - this.view.halfH() * 0.9, "lever", { size: FONT.body }).setDepth(5));
    }
  }

  /**
   * Route a surfaced deploy ability to its verb (D67): a trap keeps the place-trap flow,
   * Dig In its hunker verb, a self-cast resolves immediately, and a targeted ability arms
   * for a click — all the same `availableSkills` projection the buttons came from.
   */
  private onDeploySkillButton(actor: Unit, skill: SkillDef): void {
    if (this.busy || this.deployActor !== actor || actor.captured || this.deployActed) return;
    if (skill.effect.kind === "placeTrap") return this.placeTrap(skill.effect, skill.cost?.material);
    if (skill.id === "dig-in") return this.digIn();
    if (skill.effect.kind === "med-heal") return this.openHerbMenu(actor, skill, "deployment"); // the Medic pre-heals (D67 W8)
    if (skill.target === "self") return this.castDeploySkill(actor, skill, actor);
    this.armTargetedSkill(actor, skill, "deployment");
  }

  /**
   * Arm a targeted ability for a click — the shared tail of both skill routers: set the
   * armed skill, repaint the board read for the new aim (the deploy reach wash vs. the
   * combat footprint preview), and prompt for a target with the same message in either phase.
   */
  private armTargetedSkill(actor: Unit, skill: SkillDef, ctx: BoardCtx): void {
    this.armedSkill = skill;
    if (ctx === "deployment") {
      this.drawDeployReach(); // aiming clears the movement wash (the armed read is combat-only)
    } else {
      this.armedAim = null;
      this.drawPreview();
    }
    this.setHint(`${skill.name}: click a valid target (or click ${actor.name} to cancel).`);
  }

  /**
   * Med-heal's two-step pick (D44/D67 W8): choose a carried herb, then arm the skill for an
   * ally click — the **same** flow in either phase. Picking a herb sets `pendingHerb` and hands
   * off to {@link armTargetedSkill} (which paints the right per-phase aim read), so the deploy
   * Medic pre-heals a wounded unit exactly as the combat Medic heals mid-fight.
   */
  private openHerbMenu(actor: Unit, skill: SkillDef, ctx: BoardCtx): void {
    const herbs = medicalHerbs().filter((h) => countOf(this.run.inventory, h) > 0);
    if (herbs.length === 0) return void this.setHint("No herbs carried — provision some at camp.");
    this.layoutActionMenu(
      herbs.map((h) => ({
        text: `${h} (${countOf(this.run.inventory, h)})`,
        description: `Heal with ${h}.`,
        onClick: () => {
          this.pendingHerb = h;
          this.armTargetedSkill(actor, skill, ctx); // armedSkill + the ctx aim read + the prompt
          this.setHint(`Heal (${h}): click a wounded ally (or click ${actor.name} to cancel).`);
        },
      })),
    );
  }

  /**
   * Cast a dual-context ability during Deployment (D67) — the **same** `useSkill` verb as
   * combat. The interpreter resolves the effect and **arms its cooldown** (D67 W5: a skill
   * used in staging is genuinely used), but the deploy clock owns the turn, so no CT is spent
   * here. Logged + undoable; it spends the unit's **act** (via the shared {@link
   * commitFieldAct} seam, D67 W4), leaving its **move** free, so a Dash → reposition works.
   * The damage/heal float + log already ride the bus (wired up front); the cast adds the same
   * impact pop combat plays — a heal/buff pop on a friendly target, or a strike on a foe. In
   * the **default** staging the enemy roster is concealed (W6), so only friendly targets are
   * castable and it's always the support pop; a strike would only fire against an *engageable*
   * pre-combat foe (a keep-assault scenario, W7) — there's no longer a blanket "no strikes in
   * staging" rule, only "no engaging the concealed."
   */
  private castDeploySkill(actor: Unit, skill: SkillDef, target: Unit): void {
    if (this.busy || actor.captured || this.deployActed) return;
    const herb = this.pendingHerb;
    this.armedSkill = null;
    this.pendingHerb = null;
    // Med-heal spends a carried herb (the Medic, D67 W8); every other skill resolves via the
    // one useSkill verb. Both pre-combat: resolve + arm cooldown, no CT (the deploy clock owns
    // the turn). If the herb vanished between pick and click, nothing committed — reopen the row.
    if (skill.effect.kind === "med-heal" && herb) {
      const out = this.battle.useHeal(actor, skill, target, herb, this.run.inventory, { commitTurn: false });
      if (out.healed === undefined && out.cleansed === undefined) {
        this.refreshDeployButtons();
        return void this.setHint("That herb isn't carried anymore.");
      }
    } else {
      this.battle.useSkill(actor, skill, target);
    }
    // Friendly target → the heal/buff pop; an engageable foe → the strike (keep-assault only —
    // the default staging conceals enemies, so this is the support pop in all current content).
    if (target.side === actor.side) this.flashHeal(target);
    else this.flashAttack(actor, target);
    // Skill-specific render (a cast may buff/move units): re-place tokens + relight the reach
    // (the move is still free). The act-economy commit + deploy-row refresh is the shared seam.
    this.refreshAuras();
    for (const u of this.battle.units) this.placeView(u);
    this.highlightTile(actor.pos);
    this.drawDeployReach();
    this.commitFieldAct(actor, "deployment", `${actor.name} used ${skill.name}. Reposition or End Turn (Space) to advance the net.`);
  }

  private refreshDeployStatus(): void {
    const actor = this.deployActor;
    const kits = countOf(this.run.inventory, "trap-kit");
    // The title now carries only the *global* deploy state — the net's reach, your
    // safe radius, kits. The per-unit band + capture risk live on the focus card.
    const reach = this.front?.radius ?? "—";
    const safeR = this.campfire?.radius ?? "—";
    const who = actor ? (actor.captured ? `${actor.name} captured` : `${actor.name}'s turn`) : "set up";
    this.titleText.setText(`Deployment — ${who} · reach ${reach} · safe ${safeR} · ${kits} kit${kits === 1 ? "" : "s"}`);
    this.refreshObjectives(); // the objectives check-list shows in deployment too
    this.drawRail(true); // the CT rail (player units + the net's next sweep) shows in deployment too
    this.refreshFocusCard();
    this.refreshPreviewCard();
  }

  /**
   * Light the deploy actor's reach (D-feel: the deploy turn now reads like a battle turn).
   * Reuses {@link CombatView.drawPreview} in `"deploy"` mode — the reach wash for the
   * remaining {@link moveBudget} plus the lit hover path — which **suppresses the
   * strike telegraph and enemy intents** (engagement is combat-only; the deploy preview
   * must never offer a strike). Layered over the green/red zone washes, under the markers.
   * Clears when it's not a live deploy turn (between turns, captured, busy, or aiming a
   * skill — the armed footprint is the combat read, not part of this movement wash).
   */
  private drawDeployReach(): void {
    if (!this.deployReachGfx) {
      this.deployReachGfx = this.add.graphics().setDepth(0.47); // over the zone washes (0.4/0.45), under markers/tokens
      this.boardObjects.push(this.deployReachGfx);
    }
    const actor = this.deployActor;
    if (!actor || actor.captured || this.busy || this.over || this.phase !== "deployment" || this.armedSkill) {
      this.deployReachGfx.clear();
      return;
    }
    const hoverPath = this.deployHoverTile
      ? this.reachByKey.get(`${this.deployHoverTile.col},${this.deployHoverTile.row}`)?.path
      : undefined;
    this.view.drawPreview(this.deployReachGfx, actor, this.battle.units, this.grid, {
      moveBudget: this.moveBudget,
      acted: true, // no strike telegraph (also gated by mode) — engagement is combat-only
      hoverPath,
      mode: "deploy",
    });
  }

  /**
   * Paint the influence zones (D63 / D-feel): green **safe** core (campfire-protected,
   * capture-immune), a faint **neutral** wash on open ground (unprotected — a real,
   * lower capture risk, so it reads as mild danger, not free space), red **danger**
   * inside the net, and an amber telegraph on the ring about to fall next turn.
   * Party-wide — drawn only when the sources change (enter / front turn), never per unit.
   */
  private drawZones(): void {
    if (!this.safeZoneGfx) {
      this.safeZoneGfx = this.add.graphics().setDepth(0.4);
      this.boardObjects.push(this.safeZoneGfx);
    }
    if (!this.dangerZoneGfx) {
      this.dangerZoneGfx = this.add.graphics().setDepth(0.45);
      this.boardObjects.push(this.dangerZoneGfx);
    }
    // The zone painter (#131) fills + outlines the bands into the two graphics off the sources.
    paintZones(this.view, this.safeZoneGfx, this.dangerZoneGfx, this.grid, this.campfire, this.front);
    // The tarpit ring renders in Deployment too (D64) — position around the tax.
    this.refreshAuras();
    // The extraction exit span (D97) — painted in deploy and kept through battle.
    this.drawExitZone();
  }

  /**
   * Tint the **extraction exit span** (D97) — the "escape route" a freed prisoner must reach
   * to win by extraction (the finale's second win-path). A static gold overlay shown only when
   * the staged encounter carries an `extraction` objective; absent otherwise. Unlike the deploy
   * safe/danger zones (retired on `battleBegan`), this persists into battle — the escort happens
   * mid-fight. Lazily created + pushed to `boardObjects`; reset in {@link rebuildBoard} (D96).
   */
  private drawExitZone(): void {
    const ext = this.loop.staged?.objectives.find((o) => o.spec.kind === "extraction")?.spec;
    if (!ext?.span?.length) return;
    if (!this.exitZoneGfx) {
      this.exitZoneGfx = this.add.graphics().setDepth(0.42);
      this.boardObjects.push(this.exitZoneGfx);
    }
    this.exitZoneGfx.clear();
    for (const t of ext.span) this.view.fillTile(this.exitZoneGfx, t, COLOR.exit, 0.22, COLOR.exit);
  }

  /** True when the staged encounter carries an extraction objective (the finale, D97). */
  private hasExtraction(): boolean {
    return !!this.loop.staged?.objectives.some((o) => o.spec.kind === "extraction");
  }

  /**
   * Step the active unit to a clicked **lit** tile, spending that leg's **weighted**
   * cost from the shared {@link moveBudget} — the one movement path for both phases
   * (D-feel consolidation). Only tiles in `reach` (the remaining budget) are walkable; a
   * click outside it just hints. A cost-changing effect (the Heavy-Knight tarpit ring,
   * D42) is charged **identically** in deploy and battle now — the spend reads the same
   * weighted reach the wash is drawn from, so the two can never drift. Per-step trap
   * sensing can halt it short; it commits through the shared {@link "../../core/turn".Battle.moveUnit}
   * verb (logged + undoable, springs any entity crossed, breaks dig-in), then hands the
   * after-step to the phase ({@link afterDeployMoveStep} / {@link afterBattleMoveStep}).
   */
  private moveStep(actor: Unit, tile: GridCoord, ctx: BoardCtx): void {
    if (actor.captured || this.busy) return;
    const deploy = ctx === "deployment";
    const r = this.reachByKey.get(`${tile.col},${tile.row}`);
    if (!r || r.path.length === 0) {
      const more = this.canMoveFurther();
      return this.setHint(
        deploy
          ? more
            ? "Out of reach — click a lit tile (you step, not leap)."
            : "Out of moves this turn — Dig In, place a trap, or End Turn (Space)."
          : more
            ? "Out of reach — click a lit tile (you move in steps, not leaps)."
            : `${actor.name} is out of moves — strike a foe, use a skill, or End Turn (Space/W).`,
      );
    }
    // Per-step trap read (D12): the unit may sense a hidden enemy trap and stop short, or
    // blunder onto one it missed. Truncate the click's route to what it actually walks; a
    // trap it already spotted halts it short (you don't step onto one you see).
    const spot = this.readStepTraps(actor, r.path, (sensed) =>
      `${actor.name} ${sensed ? "senses a hidden trap" : "won't step onto the spotted trap"} ` +
        `(${ICON.trapArmed.glyph}) — route around it, Disarm it, ${deploy ? "" : "strike, "}or End Turn.`,
    );
    if (!spot) return; // balked on a trap — hold ground (hint already set)
    const walked = spot.path;
    // The walked route ends on a tile from the original reach, so its weighted cost is
    // exactly the reach cost to that halt tile (a tarpit ring costs extra to enter, D42).
    const halt = walked[walked.length - 1];
    const cost = this.reachByKey.get(`${halt.col},${halt.row}`)?.cost ?? r.cost;
    const hpBefore = actor.hp;
    this.busy = true;
    this.hoverTile = null;
    if (!deploy) {
      // Battle: a move clears any armed strike/skill aim and its action row (the strike
      // telegraph re-arms after the step). Deployment has no strike to clear.
      this.armedSkill = null;
      this.clearActionButtons();
      this.highlightTile(null);
      this.armedAim = null;
    }
    this.battle.moveUnit(actor, walked);
    if (deploy) this.deployMoved = true;
    else this.movedThisTurn = true;
    this.moveBudget -= cost; // weighted spend — same in both phases
    this.animateMove(actor, walked, () =>
      deploy
        ? this.afterDeployMoveStep(actor, !!spot.spotted, hpBefore)
        : this.afterBattleMoveStep(actor, !!spot.spotted, hpBefore),
    );
  }

  /** The deploy after-step: relight the (smaller) reach, surface trap/feedback, chain clicks. */
  private afterDeployMoveStep(actor: Unit, spotted: boolean, hpBefore: number): void {
    this.busy = false;
    this.highlightTile(actor.pos);
    this.refreshAuras(); // a repositioned Heavy Knight drags its tarpit ring (D64)
    this.checkTrapSprings(); // a missed trap just sprang underfoot — reveal + mark it
    if (spotted) this.redrawTrapMarkers(); // a sensed trap — draw its fresh marker
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.recomputeReach(actor); // budget spent + new position — relight the smaller reach
    this.drawDeployReach();
    const moreMoves = this.moveBudget > 0 && !spotted;
    this.setHint(
      spotted
        ? `${actor.name} senses a hidden trap just in time (${ICON.trapArmed.glyph}) and stops short — Disarm it, place a trap, or End Turn.`
        : actor.hp < hpBefore
          ? `${ICON.trapSprung.glyph} ${actor.name} stepped on a hidden trap! Dig In, place a trap, or End Turn.`
          : `${actor.name} repositioned${moreMoves ? ` (${this.moveBudget} move left)` : ""}. ${moreMoves ? "Step again, " : ""}Dig In, place a trap, or End Turn (Space).`,
    );
    // Click-ahead: replay a tile click made while this step animated (micro-movement).
    this.processQueuedClick(actor, "deployment");
  }

  /** The battle after-step: end if the move decided it, else keep the turn open (D60). */
  private afterBattleMoveStep(actor: Unit, spotted: boolean, hpBefore: number): void {
    this.checkTrapSprings();
    if (spotted) this.redrawTrapMarkers(); // a sensed trap — draw its fresh marker
    this.refreshHud();
    if (!actor.alive || this.encounterDecided()) {
      this.busy = false;
      return this.afterTurn();
    }
    if (actor.hp < hpBefore) this.turnLocked = true; // a trap bit — the move stands
    this.afterActionContinue(actor);
    // Override the generic turn hint when the unit balked at a freshly-sensed trap.
    if (spotted && this.waitingFor === actor && !this.over) {
      this.setHint(`${actor.name} senses a hidden trap (${ICON.trapArmed.glyph}) and stops short — Disarm it, strike, or End Turn.`);
    }
  }

  /** Drop the capture-net cage on a unit's tile (shared deploy FX). */
  private dropNet(unit: Unit): void {
    const { x, y } = this.tileToWorld(unit.pos);
    this.boardObjects.push(dropNetCage(this, x, y - this.view.halfH()));
  }

  private placeTrap(effect: PlaceTrapEffect, material?: MaterialCost): void {
    const actor = this.deployActor;
    if (!actor || actor.captured || this.busy) return;
    // The rules (kit cost, tile clear, entity registration, use-XP) run through the
    // one interpreter now (D63: Battle.placeTrap → the logged, undoable placeTrap
    // action); the scene keeps only the board marker, keyed by entity id. The kit price
    // (#113) is declared on the SkillDef and consumed commit-side by apply.
    const id = this.trapLayer.nextTrapId();
    const res = this.battle.placeTrap(actor, actor.pos, effect, id, material);
    if (!res.ok) {
      this.setHint(res.reason ?? "Can't place a trap here.");
      return;
    }
    this.trapLayer.addPlayerTrap(id, actor.pos);
    this.refreshSituationCard();
    this.deployActed = true;
    actor.dugIn = false; // placing a trap is an act — breaks the hunker (the "on action" trigger)
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint((res.levels ?? 0) > 0
      ? `Trap placed — ${actor.name} reached L${actor.level}! End Turn (Space) to advance the net.`
      : "Trap placed. End Turn (Space) to advance the net.");
  }

  // --- Phase: Battle ---------------------------------------------------------

  private startBattle(): void {
    this.phase = "battle";
    // Cross the pre-combat → combat boundary (D67): a *logged* transition that flips the
    // Battle's phase and announces it. The bus listener (wireBattleFx) tears down the
    // staging visuals — lifts the D12 veil so the foe resolves into view, retires the
    // deploy overlays + markers — and the log marker lets replay delimit the deploy prelude.
    this.battle.beginBattle();
    this.titleText.setText("Battle");
    this.situationCard.resetView("camp"); // foes are on the board now — default the situation card back to Camp
    this.refreshSituationCard();
    this.drawRail(false); // swap the deploy rail (player + net) for the full combat roster
    this.legendStrip.setItems(this.hasExtraction() ? [...BATTLE_LEGEND, EXIT_LEGEND_ITEM] : BATTLE_LEGEND);
    this.clearActionButtons();
    this.theftAttempts.clear();
    this.goldStolen = 0;
    this.goldRecovered = 0;
    this.pendingRecruits = [];
    this.bribeArmed = false;
    this.deployActor = null;
    this.highlightTile(null);

    // The damage / heal / defeat / trapSprung FX are already wired for this encounter's
    // bus (wireBattleFx, at node start) so they fire in deployment too — don't re-attach
    // here or battle would double-float and double-log. Only the per-turn header is
    // combat-only: deployment has no per-unit "— Name —" cadence worth logging.
    this.battle.bus.on("turnStart", ({ unit }) => this.view.logTurn(unit));

    // Snapshot primary-job levels so resolution can read out who leveled up (D53).
    this.preBattleJobLevels = new Map(this.battle.units.filter((u) => u.side === "player").map((u) => [u.id, jobLevelOf(u, u.primaryJob)]));

    // beginBattle: Chef heal + morale-warmed initiative seed (D8).
    const healed = this.loop.beginBattle();
    this.refreshSituationCard();
    if (healed > 0) for (const u of this.battle.units) if (u.side === "player" && u.alive) this.flashHeal(u);

    // Trap-field (D12): an opening party scan from the deploy line reveals the
    // nearest concealed traps; the rest are spotted as units advance (or Search).
    if (hiddenTraps(this.battle.entities).length > 0) {
      for (const u of this.battle.units) if (u.side === "player" && u.alive) revealTrapsNear(u, this.battle.entities, this.spotRng);
      this.redrawTrapMarkers();
    }

    this.refreshHud();
    this.setPrimary("Advance Clock");
    const bound = this.battle.units.find((u) => u.captured && u.side === "player");
    const trapHint = hiddenTraps(this.battle.entities).length > 0 || this.trapLayer.enemyCount > 0
      ? `Traps are seeded ahead — watch for ${ICON.trapArmed.glyph}, and let a trapper disarm them. `
      : "";
    this.setHint((healed > 0 ? `Chef's stew restored ${healed} HP. ` : "Battle begins. ") + trapHint + (bound ? `${bound.name} is bound — reach and free them, or win the field. ` : "") + "Press Advance Clock.");
  }

  private onPrimary(): void {
    if (this.phase === "deployment") {
      // Mirror combat (D63): the primary is End Turn while a unit is acting, and
      // Advance Clock between turns — so the net only ever steps on an explicit
      // input. Guarded against the busy window after a capture / overrun auto-start.
      if (this.busy) return;
      if (this.deployActor) this.endDeployTurn(this.deployActor);
      else this.deployNextActor();
    } else if (this.phase === "battle") {
      // During a player turn the primary button IS End Turn (D60); otherwise it
      // advances the clock to the next actor.
      if (this.waitingFor && !this.busy) this.endPlayerTurn(this.waitingFor);
      else this.onAdvance();
    } else if (this.phase === "resolution") this.returnToOverworld();
  }

  private onAdvance(): void {
    if (this.over || this.busy || this.waitingFor) return;
    if (this.encounterDecided()) return this.finishBattle();
    const actor = this.battle.nextActor();
    // The clock tick inside nextActor may have closed a gate (D50) — re-poll, then
    // let the pure decision pick the branch the scene renders (D60 Phase B).
    const out = advanceOutcome(actor, this.encounterDecided());
    if (out.kind === "finish") return this.finishBattle();
    this.revealScouted();
    this.highlightTile(out.actor.pos);
    this.refreshHud();
    // A hidden ambush body lies in wait — it doesn't act until the party scouts it
    // into view (D42/D44 fog); it just passes its turn.
    if (out.kind === "ambushPass") {
      this.battle.endTurn(out.actor, {});
      this.setHint("Something stirs in ambush ahead… scout it out.");
      return;
    }
    if (out.kind === "enemyTurn") this.runEnemyTurn(out.actor);
    else this.beginPlayerTurn(out.actor);
  }

  /**
   * Open a player unit's **free-move turn** (D60): seed the movement budget, clear
   * the per-turn flags, spot nearby traps, and surface the board read (reach wash +
   * strike telegraph) and the action row. The big primary button becomes **End
   * Turn** — the obvious, deliberate way to close the turn. A unit with nothing it
   * can do auto-passes (the D55 backstop) so the clock can't stall.
   */
  private beginPlayerTurn(actor: Unit): void {
    this.view.setActiveUnit(actor);
    this.waitingFor = actor;
    this.moveBudget = moveBudget(actor);
    this.acted = false;
    this.actCharged = false;
    this.movedThisTurn = false;
    this.turnLocked = false;
    // Arm the action-log undo for the turn (D60 take-back) — every move/strike/skill
    // the unit makes becomes undoable back to this point, until the turn commits.
    this.battle.beginUndo();
    this.hoverTile = null;
    this.hoverFoe = null;
    this.queuedTile = null;
    this.armedAim = null;
    this.recomputeReach(actor);
    // The active unit looks around — an Awareness roll may spot nearby traps (D12).
    this.scanTrapsOnTurnOpen(actor); // combat lets the generic turn hint stand below
    if (this.noActionsAvailable(actor)) {
      this.setHint(`${actor.name} has no available action — turn passed. Advance Clock.`);
      this.endPlayerTurn(actor);
      return;
    }
    this.setPrimary("End Turn");
    this.showSkillButtons(actor);
    this.drawPreview();
    this.highlightTile(actor.pos);
    this.refreshFocusCard();
    this.setHint(this.turnHint(actor));
  }

  /** Recompute the reachable tiles for the unit's *remaining* budget (move + hover). */
  private recomputeReach(actor: Unit): void {
    this.reach = this.moveBudget > 0 && !isImmobilized(actor)
      ? reachableTiles(actor, this.battle.units, this.grid, this.moveBudget)
      : [];
    this.reachByKey = new Map(this.reach.map((r) => [`${r.tile.col},${r.tile.row}`, r]));
  }

  /** The contextual turn prompt — what the unit can still do this turn (D60). */
  private turnHint(actor: Unit): string {
    const canMove = this.canMoveFurther();
    if (this.acted) {
      return canMove
        ? `${actor.name} struck — still has ${this.moveBudget} move left. Click a lit tile, then End Turn (Space/W).`
        : `${actor.name} has acted. End Turn (Space/W).`;
    }
    return canMove
      ? `${actor.name}'s turn — click a lit tile to move, click a highlighted foe to strike, use a skill, or End Turn (Space/W).`
      : `${actor.name}'s turn — strike a highlighted foe, use a skill, or End Turn (Space/W).`;
  }

  /** True if the unit has budget and at least one reachable tile beyond its own. */
  private canMoveFurther(): boolean {
    return this.moveBudget > 0 && this.reach.some((r) => r.path.length > 0);
  }

  /**
   * The auto-end gate (D60): a turn ends on its own only when **both** halves are
   * spent — the Act is used *and* there's no movement left. Anything short of that
   * (movement remaining, or an Act still available) keeps the turn open so it never
   * closes on the player unexpectedly; they press End Turn when they're done.
   */
  private turnExhausted(): boolean {
    return this.acted && !this.canMoveFurther();
  }

  /**
   * True when `actor` has no legal action this turn (D55): can't reach a tile,
   * can't strike any foe, has no battle skill, and no Search/Disarm/Bribe/rescue
   * verb. The auto-pass backstop reads this so a surrounded unit can't deadlock.
   */
  private noActionsAvailable(actor: Unit): boolean {
    // The D55 backstop is a pure scan now (battle-flow, D60 Phase B).
    return scanNoActions({ actor, units: this.battle.units, grid: this.grid, entities: this.battle.entities, hasGuild: !!this.guild });
  }

  /**
   * **End the active unit's turn** (D60) — the explicit End Turn button / W key, the
   * turn-start no-action backstop, and the auto-end-when-spent path all route here.
   * Spends CT from what the unit actually did this turn (`moved`/`acted`), so a unit
   * that only stepped pays the cheap Move cost and a unit that struck pays the Act.
   */
  private endPlayerTurn(actor: Unit): void {
    if (this.busy || this.waitingFor !== actor) return;
    this.battle.endUndo(); // the turn commits — no take-back across the boundary
    this.waitingFor = null;
    this.armedSkill = null;
    this.pendingHerb = null;
    this.bribeArmed = false;
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.armedAim = null;
    this.focusCard.hide();
    this.battle.endTurn(actor, { moved: this.movedThisTurn, acted: this.actCharged });
    this.afterTurn();
    if (!this.over) this.setHint(`${actor.name}'s turn ends. Advance Clock.`);
  }

  /**
   * Continue an *open* turn after a move or Act (D60): refresh the board, then either
   * auto-end (both halves spent) or re-surface the reach/strike read and the action
   * row so the unit can keep moving or take its Act. The single resume point every
   * non-ending player action funnels through.
   */
  private afterActionContinue(actor: Unit): void {
    this.busy = false;
    if (this.over) return;
    if (this.encounterDecided()) return this.finishBattle();
    this.recomputeReach(actor);
    if (this.turnExhausted()) {
      this.endPlayerTurn(actor);
      return;
    }
    this.highlightTile(actor.pos);
    this.showSkillButtons(actor);
    this.drawPreview();
    this.refreshFocusCard();
    this.setHint(this.turnHint(actor));
    // Click-ahead: replay any board click made while this step was animating, so rapid
    // tile-by-tile movement flows without dropping inputs (micro-movement).
    this.processQueuedClick(actor, "battle");
  }

  private showSkillButtons(actor: Unit): void {
    const specs: ActionSpec[] = [];
    // Turn-control: Undo lives in the control box (with End Turn), apart from the verbs —
    // available whenever this turn's actions can be taken back (a move *or* a strike/skill),
    // as long as no sprung trap has locked it (no take-back on damage taken, D60). Routes
    // through the action log (Phase 2).
    // Undo is **persistent** beside End Turn so the take-back affordance is always visible —
    // greyed/inert until there's something on this turn's stack (and no sprung-trap lock).
    const canUndo = this.battle.canUndo() && !this.turnLocked;
    const undo: ActionSpec = {
      text: "Undo",
      description: canUndo
        ? "Take back everything this unit did this turn — moves and strikes — back to where it started (Esc)."
        : "Nothing to take back yet — move or act, then Undo returns the unit to where it started.",
      enabled: canUndo,
      onClick: () => this.undoTurn(actor, "battle"),
    };
    // The Act buttons (skill / Bribe / Search / Disarm / Defend) are the unit's one
    // action this turn — surfaced only until that Act is spent (D60).
    if (!this.acted) {
      // Level-gated actives (D39): a 2nd active unlocks as the job levels — so combat
      // growth shows up here, in every fight. Each is numbered for its 1–9 key (D55).
      availableSkills(actor, "combat").filter((s) => s.id !== DEFEND.id).forEach((skill, i) => {
        // Surface the per-skill cooldown (D37): an armed skill is *live* state that
        // was invisible — show it's cooling and steer the click to a hint rather than
        // letting a re-use slip through (the menu now enforces what the clock tracks).
        const cooling = onSkillCooldown(actor, skill.id);
        specs.push({
          text: `${i + 1}  ${skill.name}${cooling ? "  · cooling" : ""}`,
          description: cooling
            ? `${skill.name} is cooling down — ready again in a turn or two.`
            : `${skill.name} — ${skill.description}  ·  key ${i + 1}`,
          onClick: () => (cooling ? this.setHint(`${skill.name} is still cooling down.`) : this.onSkillButton(actor, skill)),
        });
      });
      // The Noble's mid-combat BRIBE (D30/D33): spend the run's per-expedition Influence
      // (D62) to sway an enemy. Job-gated (D62) — only surfaced when a Noble is in the
      // party to broker it (the standing-bearer backs the offer, even from camp). A
      // permanent recruit still banks to the guild roster.
      const noble = this.run.party.find((u) => u.alive && !u.captured && primaryJobOf(u) === "noble");
      if (this.guild && noble && this.battle.units.some((u) => u.side === "enemy" && u.alive)) {
        const tier = influenceTier(this.run.overworld.influence);
        const cost = bribeCost(this.currentPreview(), tier);
        const chance = Math.round(bribeChance(tier) * 100);
        const affordable = this.run.overworld.influence >= cost;
        // Tag the verb with the Noble: unlike the other Acts this isn't the *active* unit's
        // own skill — it's brokered by the party's standing-bearer (D62), so name them.
        specs.push({
          text: `Bribe · ${noble.name}`,
          description: affordable
            ? `${noble.name} (Noble) sways an enemy for ${cost} Influence — ~${chance}% at ${tier} standing (a failed roll still spends the Influence and the Act). A generic turns coat for the fight; an authored one joins the guild permanently.`
            : `Not enough Influence to bribe (need ${cost}).`,
          onClick: () => {
            if (!affordable) return this.setHint(`Not enough Influence to bribe (need ${cost}).`);
            this.bribeArmed = true;
            this.armedSkill = null;
            this.setHint(`Bribe: click an enemy to sway it (or click ${actor.name} to cancel).`);
          },
        });
      }
      // Trap-field verbs (D12): Search to scan for hidden traps; the trapper disarms a
      // spotted, adjacent one to pocket its kit. The same shared row helper as deployment.
      this.pushTrapVerbs(specs, actor, "battle");
      this.pushGateVerbs(specs, actor, "battle"); // Pick Cell — lockpick an adjacent locked gate (D103)
      // The universal Defend (D41): every unit can brace until its next turn — the
      // always-available defensive verb, even for a unit with no job actives.
      // The universal Defend (D41) keeps its dedicated "D" key, sourced from the same
      // availableSkills projection (D67) — no separate hardcoded append.
      const defend = availableSkills(actor, "combat").find((s) => s.id === DEFEND.id);
      if (defend) specs.push({ text: "Defend (D)", description: `${defend.description}  ·  key D.`, onClick: () => this.onSkillButton(actor, defend) });
    }
    // The turn's explicit close is the prominent green primary button (plus Space and
    // W) — so the verb box carries only the unit's *verbs*; Undo sits side-by-side with
    // End Turn in the separate control box below.
    this.layoutActionMenu(specs, { undo });
  }

  // --- Trap-field: spotting, searching, disarming (D12) ----------------------

  /**
   * The on-turn-open Awareness scan (D12), shared by **both** phases' turn-start: a unit
   * stepping up may passively spot nearby concealed traps. Reveals them, redraws the
   * markers if any surfaced, and returns the count — the caller folds it into its turn
   * hint (deployment names the spot; combat lets the generic turn hint stand). A no-op
   * when no traps are afield.
   */
  private scanTrapsOnTurnOpen(actor: Unit): number {
    if (hiddenTraps(this.battle.entities).length === 0) return 0;
    const found = revealTrapsNear(actor, this.battle.entities, this.spotRng);
    if (found.length > 0) this.redrawTrapMarkers();
    return found.length;
  }

  /** A revealed, un-sprung concealed trap adjacent to `actor` (the disarm target). */
  private adjacentRevealedTrap(actor: Unit): ConcealedTrap | undefined {
    return findAdjacentRevealedTrap(actor, this.battle.entities); // pure (battle-flow, D60 Phase B)
  }

  /** Mark the unit's single Act spent this turn (D60); `charged` drives the CT cost. */
  private noteAct(charged = true): void {
    this.acted = true;
    this.actCharged = charged;
  }

  /**
   * Can `actor` still take a field-interaction Act (Search / Disarm) this turn? The one
   * guard for both phases — the deploy turn and the combat turn share the "one Act, not
   * while busy, not captured" rule; only the *who's-acting* / *already-acted* fields differ.
   */
  private canFieldAct(actor: Unit, ctx: BoardCtx): boolean {
    if (this.busy || actor.captured) return false;
    return ctx === "deployment" ? this.deployActor === actor && !this.deployActed : this.waitingFor === actor && !this.acted;
  }

  /**
   * Spend the unit's Act and continue the turn — the **one** act-economy commit for both
   * phases and every Act type (Search / Disarm and the skill cast, D67 W4). Deployment just
   * marks the act and re-surfaces the deploy row (the net steps on End Turn, not here); combat
   * goes busy, charges the Act's CT (`noteAct`) and funnels through `afterActionContinue`
   * (auto-end / re-surface). `charged` is the Act's CT weight in **combat** — a move-spend
   * skill (Dash) bills as a move, not the full Act (deployment treats every cast as the
   * turn's one act regardless). The optional `hint` is applied last when given.
   */
  private commitFieldAct(actor: Unit, ctx: BoardCtx, hint?: string, charged = true): void {
    if (ctx === "deployment") {
      this.deployActed = true;
      actor.dugIn = false; // acting breaks the hunker (the status-effect "on action" trigger); moving already clears it in moveUnit
      this.refreshDeployButtons();
      this.refreshDeployStatus();
    } else {
      this.busy = true;
      this.clearActionButtons();
      this.highlightTile(null);
      this.hoverTile = null;
      this.armedAim = null;
      this.noteAct(charged);
      this.afterActionContinue(actor);
    }
    if (hint) this.setHint(hint);
  }

  /** Spend this unit's Act on a deliberate Search — a wider radius and a better spot roll (both phases). */
  private doSearch(actor: Unit, ctx: BoardCtx): void {
    if (!this.canFieldAct(actor, ctx)) return;
    const found = revealTrapsNear(actor, this.battle.entities, this.spotRng, { search: true });
    if (found.length > 0) this.redrawTrapMarkers();
    // Deployment narrates the search result; combat lets afterActionContinue's turn hint stand.
    const hint = ctx === "deployment"
      ? found.length > 0
        ? `${actor.name} searches and spots ${found.length} hidden trap${found.length > 1 ? "s" : ""} (${ICON.trapArmed.glyph}). Reposition or End Turn.`
        : `${actor.name} searches but turns up nothing here. Reposition or End Turn.`
      : undefined;
    this.commitFieldAct(actor, ctx, hint);
  }

  /** Disarm a spotted adjacent trap (Survivalist), harvest its kit — the unit's Act (both phases). */
  private doDisarm(actor: Unit, trapId: string, ctx: BoardCtx): void {
    if (!this.canFieldAct(actor, ctx)) return;
    const res = disarmTrap(this.battle.entities, trapId, actor, this.run.inventory);
    if (!res.ok) return this.setHint(`Can't disarm: ${res.reason}`);
    this.redrawTrapMarkers();
    this.refreshSituationCard();
    const tail = ctx === "deployment" ? " Reposition or End Turn." : "";
    const hint = res.harvested
      ? `${actor.name} disarms the trap and pockets a ${res.harvested}.${tail}`
      : `${actor.name} disarms the trap (storage full — the kit is lost).${tail}`;
    this.commitFieldAct(actor, ctx, hint);
  }

  /**
   * Sync the board markers to the concealed traps: a {@link ICON.trapArmed} on each
   * revealed armed trap, a faded {@link ICON.trapSprung} once sprung, and nothing for
   * disarmed (removed) ones.
   */
  private redrawTrapMarkers(): void {
    this.trapLayer.redraw(this.battle.entities);
  }

  /** After a move, reveal any trap that just sprang under someone and refresh markers. */
  private checkTrapSprings(): void {
    let sprang = false;
    for (const t of this.battle.entities.all().filter(isConcealedTrap)) {
      if (t.sprung && !t.revealed) {
        t.revealed = true;
        sprang = true;
      }
    }
    if (this.trapLayer.enemyCount > 0 || sprang) this.redrawTrapMarkers();
    if (sprang) this.setHint(`${ICON.trapSprung.glyph} A hidden trap sprang!`);
  }

  /**
   * The per-step trap read shared by both phases' movement (D12): walk `steps` until a
   * hidden enemy trap is sensed (stop short) or an already-spotted one blocks the next
   * tile. Returns the spot result — the caller walks `spot.path`; on a full balk (nothing
   * walked) it draws any freshly sensed marker, sets the phase's `balkHint`, and returns
   * `null` so the caller bails. Both phases now walk through the one `moveUnit` verb (D67);
   * only the post-walk continuation (deploy budget vs. the combat turn) differs by caller.
   */
  private readStepTraps(
    actor: Unit,
    steps: readonly GridCoord[],
    balkHint: (sensed: boolean) => string,
  ): ReturnType<typeof spotWhileMoving> | null {
    const spot = spotWhileMoving(actor, steps, this.battle.entities, this.spotRng);
    if (spot.path.length === 0) {
      if (spot.spotted) this.redrawTrapMarkers(); // a trap sensed *now* on the blocked tile — mark it
      this.setHint(balkHint(!!spot.spotted));
      return null;
    }
    return spot;
  }

  /** The current combat node's banded preview (D24) — leverage for the Noble's bribe. */
  private currentPreview() {
    return previewNode(this.run, this.run.mapNodeId, scoutedTier(this.run.overworld, this.run.mapNodeId));
  }

  /** Spend the run's Influence to sway an enemy (D30/D33/D62) — the unit's Act for the turn. */
  private doBribe(actor: Unit, foe: Unit): void {
    if (!this.guild) return;
    if (this.acted) { this.bribeArmed = false; return void this.setHint(`${actor.name} has already acted.`); }
    const res = bribeEnemy(this.run, foe, this.currentPreview());
    this.bribeArmed = false;
    // Couldn't afford it (nothing spent) — leave the turn intact so the player can act.
    if (!res.applied && !res.failed) return this.setHint(`Can't bribe: ${res.reason}`);
    // On success, flip the enemy to the player's side for the rest of the fight — the logged
    // core `sway` verb (undo/replay see it), which emits `unitSwayed` so the token re-tints on
    // the bus (below). A failed sway (res.failed) still spent the Influence and the Act.
    if (res.applied) {
      this.battle.bribe(foe, actor);
      if (res.outcome?.permanent) this.pendingRecruits.push(foe);
    }
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.armedAim = null;
    this.noteAct();
    this.refreshHud();
    this.afterActionContinue(actor);
    if (!this.over && this.waitingFor === actor) this.setHint(res.detail ?? `${foe.name} swayed.`);
  }

  private onSkillButton(actor: Unit, skill: SkillDef): void {
    if (this.busy || this.waitingFor !== actor) return;
    // One Act per turn (D60): once it's spent, the skill keys/buttons are inert.
    if (this.acted) return void this.setHint(`${actor.name} has already acted — move, or End Turn (Space/W).`);
    // Respect the per-skill cooldown for the keyboard path too (D37).
    if (onSkillCooldown(actor, skill.id)) return void this.setHint(`${skill.name} is still cooling down.`);
    // Medic med-heal (D44): pick a herb from the carried stash, then a target ally.
    if (skill.effect.kind === "med-heal") return this.openHerbMenu(actor, skill, "battle");
    if (skill.target === "self") return this.commitSkill(actor, skill, actor);
    this.armTargetedSkill(actor, skill, "battle");
  }

  private commitSkill(actor: Unit, skill: SkillDef, target: Unit): void {
    const herb = this.pendingHerb;
    this.armedSkill = null;
    this.pendingHerb = null;
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.armedAim = null;
    let verb: string;
    if (skill.effect.kind === "med-heal" && herb) {
      // Spend the chosen herb on the target (D44 medic flow) — turn left open (D60).
      const out = this.battle.useHeal(actor, skill, target, herb, this.run.inventory, { commitTurn: false });
      if (out.healed === undefined && out.cleansed === undefined) {
        // The herb's no longer in the stash — nothing committed; reopen the turn.
        this.busy = false;
        this.showSkillButtons(actor);
        this.drawPreview();
        return this.setHint("That herb isn't carried anymore.");
      }
      verb = out.cleansed ? `cleanses ${out.cleansed}` : `heals ${out.healed}`;
      this.flashHeal(target);
    } else {
      const outcome = this.battle.useSkill(actor, skill, target, { commitTurn: false });
      if (skill.target === "self") this.flashHeal(target);
      else this.flashAttack(actor, target);
      verb = outcome.healed ? `heals ${outcome.healed}` : outcome.damage ? `hits for ${outcome.damage}` : outcome.charging ? "charging" : outcome.status ? `applies ${outcome.status}` : "acts";
    }
    // The skill is the unit's Act; its CT cost follows the skill's spend (D60). The commit +
    // continuation is the shared act-economy seam (D67 W4) — `charged` bills a move-spend
    // skill (Dash) as a move, not the full Act. refreshHud first so the target's HP bar lands.
    this.refreshHud();
    this.commitFieldAct(actor, "battle", undefined, skill.spend === "act");
    if (!this.over && this.waitingFor === actor) {
      this.setHint(`${actor.name} used ${skill.name} — ${verb}. ${this.canMoveFurther() ? "Move on, or " : ""}End Turn (Space/W).`);
    }
  }

  private runEnemyTurn(actor: Unit): void {
    this.view.setActiveUnit(actor);
    this.busy = true;
    this.setHint(`${actor.name} (enemy) acts…`);
    // The thief archetype (D30): on its first turn it skims the run PURSE, then
    // bolts for the edge. Kill it before it escapes to recover the gold.
    if (actor.thief && actor.alive && !this.theftAttempts.has(actor.id)) {
      const attempt = thiefSteal(this.run, Labels.thief(actor.id));
      if (attempt.stolen > 0) {
        this.theftAttempts.set(actor.id, attempt);
        this.goldStolen += attempt.stolen;
        this.refreshSituationCard();
        this.setHint(`${actor.name} lifted ${attempt.stolen}g off the purse! Cut it down before it escapes to recover the gold.`);
      }
    }
    const plan = this.battle.runPolicyTurn(actor);
    this.animateMove(actor, plan.path, () => {
      if (plan.target) this.flashAttack(actor, plan.target);
      this.afterTurn();
    });
  }

  /** Recover loot from any thief that has just died (kill-to-recover, D13/D21). */
  private resolveTheftDeaths(): void {
    for (const [id, attempt] of this.theftAttempts) {
      if (attempt.resolved) continue;
      const thief = this.battle.units.find((u) => u.id === id);
      if (thief && !thief.alive) {
        const back = recoverStolen(this.run, attempt);
        this.goldRecovered += back;
        this.refreshSituationCard();
        this.setHint(`Recovered ${back}g from the slain thief.`);
      }
    }
  }

  // --- Keyboard + legend (D55 QoL) -------------------------------------------

  /**
   * The single keyboard router. Global keys (Legend, danger zone, cancel, the
   * primary/Advance action) work in any phase; the rest are scoped to whose turn
   * it is. Number keys 1–9 trigger the active unit's battle skills in listed order.
   */
  private onKey(e: KeyboardEvent): void {
    const k = e.key;
    if (k === "l" || k === "L") return this.toggleLegend();
    if (this.legend.length > 0 && k === "Escape") return this.toggleLegend();
    if (k === "t" || k === "T") { this.showThreat = !this.showThreat; this.drawPreview(); return; }
    if (k === "f" || k === "F") { this.cycleSpeed(); return; }
    if (k === " " || k === "Enter") { e.preventDefault(); this.onPrimary(); return; }
    if (k === "Escape") {
      // Back out of an armed target first; otherwise take back this turn's actions.
      if (this.armedSkill || this.bribeArmed || this.pendingHerb) return this.cancelArmed();
      if (this.phase === "battle" && !this.turnLocked && this.waitingFor && !this.busy && this.battle.canUndo()) return this.undoTurn(this.waitingFor, "battle");
      // Deploy turn take-back (D63) — the same undo path, deployment context.
      if (this.phase === "deployment" && this.deployActor && !this.busy && this.battle.canUndo()) return this.undoTurn(this.deployActor, "deployment");
      return;
    }

    if (this.phase === "deployment") {
      return;
    }
    if (this.phase !== "battle" || this.busy || this.over) return;
    const actor = this.waitingFor;
    if (!actor) return;
    if (k === "w" || k === "W") return this.endPlayerTurn(actor);
    if (k === "d" || k === "D") return this.onSkillButton(actor, DEFEND);
    if (k >= "1" && k <= "9") {
      const skills = availableSkills(actor, "combat").filter((s) => s.id !== DEFEND.id);
      const idx = Number(k) - 1;
      if (idx < skills.length) this.onSkillButton(actor, skills[idx]);
    }
  }

  /** Cycle the move-animation speed 1× → 2× → 4× → 1× (faster enemy/player turns). */
  private cycleSpeed(): void {
    this.turnSpeed = this.turnSpeed >= 4 ? 1 : this.turnSpeed * 2;
    this.setHint(`Animation speed: ${this.turnSpeed}× (F to cycle).`);
  }

  /** Esc — back out of an armed skill / herb pick / bribe without spending the turn. */
  private cancelArmed(): void {
    if (!this.armedSkill && !this.bribeArmed && !this.pendingHerb) return;
    const actor = this.waitingFor;
    this.armedSkill = null;
    this.armedAim = null;
    this.bribeArmed = false;
    this.pendingHerb = null;
    if (actor) {
      this.showSkillButtons(actor);
      this.setHint(this.turnHint(actor));
    }
    this.drawPreview();
  }

  /** Toggle the Legend & Keys panel (L) — a quick reference for tokens + shortcuts. */
  private toggleLegend(): void {
    if (this.legend.length > 0) {
      clearLayer(this.legend);
      return;
    }
    const cy = this.scale.height / 2;
    const w = 540;
    const h = 360;
    const body = [
      "TOKENS",
      "  ● green — your party     ● red — enemy     ● grey — captured/bound",
      `  ${ICON.trapMine.glyph} your trap     ${ICON.trapArmed.glyph} spotted enemy trap     ${ICON.trapSprung.glyph} sprung trap`,
      "",
      "TILES",
      "  green wash — safe deploy depth     blue wash — tiles still in move budget",
      "  bright path — route to the tile under the cursor",
      "  red outline — a foe you can strike from here (red = lethal)",
      "  red wash — danger zone (toggle with T)",
      "",
      `TURN ORDER rail (top-left): who acts next · ${ICON.charging.glyph} charging`,
      "",
      "A TURN (move freely, act once): click lit tiles to move a step at a time —",
      "  spend it all at once or move, strike a foe, then move again. Your one",
      "  attack/skill can fall anywhere in that sequence. The turn ends when you",
      "  press End Turn (or once move + action are both spent). Undo resets the move.",
      "",
      "KEYS",
      "  Space/Enter — End Turn / Advance / confirm   W — End Turn",
      "  1–9 — use the active unit's skills          Esc — cancel target / Undo Move",
      "  T — danger zone     F — animation speed     L — this legend",
      "",
      "DEPLOYMENT (the closing net): green = your camp's safe core — no capture there",
      "  (wider with a stronger party, capped on small maps). Faint-red open ground is",
      "  risky; the solid-red net (grows each time it acts, amber = falls next turn) is",
      "  near-certain capture. On a unit's turn: pull back into the core, Dig In to hunker,",
      "  or set a trap — then End Turn (Space); Advance Clock (Space) grows the net. A unit",
      "  caught in the open or the net is captured (the alarm begins the battle); if the",
      "  net reaches your safe core, the battle just starts — nobody is taken.",
    ].join("\n");
    showModal(this, this.legend, {
      title: "Legend & Keys  (L to close)",
      tone: "neutral",
      w,
      h,
      cy,
      depth: 30,
      titleOffset: 20,
      titleSize: FONT.body,
      body: { text: body, offset: 44, originX: 0, padX: 22, originY: 0, color: INK.secondary, font: FONT.caption, lineSpacing: 3, noWrap: true },
    });
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const tile = this.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid || !this.grid.inBounds(tile)) return;

    if (this.phase === "deployment") {
      // Turn-based deployment (D63): only the unit whose turn it is may act. An armed deploy
      // ability commits on a valid target — the same arm→click flow as combat, through the
      // one `useSkill` verb (D67: pre-combat phase ⇒ no CT commit); otherwise a click repositions.
      if (!this.deployActor) return;
      if (this.busy) {
        // Click-ahead (micro-movement): queue a move-tile click that lands mid-step.
        if (!this.armedSkill && this.grid.isWalkable(tile) && !this.battle.units.some((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row)) {
          this.queuedTile = { col: tile.col, row: tile.row };
        }
        return;
      }
      const actor = this.deployActor;
      const clicked = this.battle.units.find((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row);
      if (this.armedSkill) {
        if (clicked === actor) {
          this.armedSkill = null;
          this.pendingHerb = null; // cancel a half-made med-heal pick too (D67 W8)
          this.refreshDeployButtons();
          this.drawDeployReach(); // un-armed by clicking self — relight the movement wash
          this.setHint(`${actor.name}'s turn — reposition, use an ability, or End Turn (Space).`);
          return;
        }
        if (clicked && isValidSkillTarget(this.armedSkill, actor, clicked)) this.castDeploySkill(actor, this.armedSkill, clicked);
        else this.setHint("Not a valid target for that skill.");
        return;
      }
      if (!clicked) this.moveStep(actor, tile, "deployment");
      return;
    }
    if (this.phase !== "battle") return;

    const actor = this.waitingFor;
    if (this.over || !actor) return;
    if (this.busy) {
      // Click-ahead (micro-movement): while a step animates, remember the latest plain
      // board click and replay it the instant the step finishes, so rapid tile-by-tile
      // clicking never drops. Armed/bribe/herb targeting isn't queued (it needs a live aim).
      if (!this.armedSkill && !this.bribeArmed && !this.pendingHerb) this.queuedTile = { col: tile.col, row: tile.row };
      return;
    }
    const clicked = this.battle.units.find((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row);

    if (this.bribeArmed) {
      if (clicked === actor) {
        this.bribeArmed = false;
        this.setHint(this.turnHint(actor));
        return;
      }
      if (clicked && clicked.side === "enemy" && !clicked.captured) this.doBribe(actor, clicked);
      else this.setHint("Pick an enemy to bribe (or click yourself to cancel).");
      return;
    }

    if (this.armedSkill) {
      if (clicked === actor) {
        this.armedSkill = null;
        this.armedAim = null;
        this.pendingHerb = null;
        this.setHint(this.turnHint(actor));
        this.drawPreview();
        return;
      }
      if (clicked && isValidSkillTarget(this.armedSkill, actor, clicked)) this.commitSkill(actor, this.armedSkill, clicked);
      else this.setHint("Not a valid target for that skill.");
      return;
    }

    this.resolveBattleClick(actor, tile);
  }

  /**
   * Route a plain (un-armed) battle click at `tile` to the right verb — free a captured
   * ally, strike a foe, or step toward the tile. Shared by {@link onPointerDown} and the
   * click-ahead {@link processQueuedClick}, so a queued click replays identically.
   */
  private resolveBattleClick(actor: Unit, tile: GridCoord): void {
    const clicked = this.battle.units.find((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row);
    if (clicked && clicked.captured && clicked.side === actor.side && clicked !== actor) this.playerRescue(actor, clicked);
    else if (clicked && clicked.side !== actor.side && !clicked.captured) this.playerAttack(actor, clicked);
    else if (clicked === actor) this.setHint(this.turnHint(actor)); // clicking yourself is a no-op nudge
    else if (!clicked && this.grid.isWalkable(tile)) this.moveStep(actor, tile, "battle");
  }

  /**
   * Replay a click-ahead (micro-movement) in either phase: if a board click landed
   * mid-step, run it now the step has finished and it's still this unit's turn. Guards
   * against any state change in the interim (busy, turn ended, a skill armed), then routes
   * to the phase's plain-click verb — combat's full {@link resolveBattleClick} (rescue /
   * strike / step), or a deploy reposition ({@link moveStep}) onto a still-empty tile.
   * Chains naturally: each replayed step's completion calls back here, so a flurry plays out.
   */
  private processQueuedClick(actor: Unit, ctx: BoardCtx): void {
    const tile = this.queuedTile;
    this.queuedTile = null;
    if (!tile || this.busy || this.over || this.armedSkill) return;
    if (ctx === "deployment") {
      if (this.phase !== "deployment" || this.deployActor !== actor || actor.captured) return;
      // Still an empty tile? (an ally may have stepped onto it while the prior step ran.)
      if (this.battle.units.some((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row)) return;
      this.moveStep(actor, tile, "deployment");
    } else {
      if (this.waitingFor !== actor || this.bribeArmed || this.pendingHerb) return;
      this.resolveBattleClick(actor, tile);
    }
  }

  /**
   * Hover routing (D60): light the route to the tile under the cursor (FE-style path
   * read) and drive the preview card. In Battle: a foe under the cursor reads as an
   * attack preview (deal / hits-back), otherwise a reachable tile lights its route. In
   * Deployment: the walkable tile under the cursor drives the capture-risk preview. A
   * cheap reach lookup — no pathfinding per move — so it can run every frame.
   */
  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.over) return;
    const tile = this.grid?.inBounds(this.worldToTile(pointer.worldX, pointer.worldY))
      ? this.worldToTile(pointer.worldX, pointer.worldY)
      : null;

    // Deployment: hover a walkable tile for its capture risk (no armed-skill hover read).
    if (this.phase === "deployment") {
      const t = this.deployActor && !this.deployActor.captured && !this.armedSkill && tile && this.grid.isWalkable(tile) ? tile : null;
      if ((t?.col ?? -1) === (this.deployHoverTile?.col ?? -1) && (t?.row ?? -1) === (this.deployHoverTile?.row ?? -1)) return;
      this.deployHoverTile = t;
      this.refreshPreviewCard();
      this.drawDeployReach(); // relight the route to the hovered tile (FE-style path read)
      return;
    }
    if (this.phase !== "battle" || !this.waitingFor || this.bribeArmed) return;
    // Armed (skill or herb-picked med-heal): track the aimed tile so the footprint +
    // forecast box recompute as the cursor moves (D64). The aim isn't gated by reach —
    // an out-of-range aim still telegraphs (the box can grey it); the legal-target wash
    // shows what's valid.
    if (this.armedSkill || this.pendingHerb) {
      if ((tile?.col ?? -1) === (this.armedAim?.col ?? -1) && (tile?.row ?? -1) === (this.armedAim?.row ?? -1)) return;
      this.armedAim = tile;
      this.highlightTile(tile ?? this.waitingFor.pos);
      this.drawPreview();
      return;
    }
    // A foe under the cursor reads as an attack preview; otherwise a reachable move tile.
    const foe = tile
      ? this.battle.units.find((u) => u.alive && !u.hidden && !u.captured && u.side !== this.waitingFor!.side && u.pos.col === tile.col && u.pos.row === tile.row) ?? null
      : null;
    const reachable = tile ? this.reachByKey.get(`${tile.col},${tile.row}`) : undefined;
    const next = !foe && reachable && reachable.path.length > 0 ? tile : null;
    const sameFoe = (foe?.id ?? "") === (this.hoverFoe?.id ?? "");
    const sameTile = (next?.col ?? -1) === (this.hoverTile?.col ?? -1) && (next?.row ?? -1) === (this.hoverTile?.row ?? -1);
    if (sameFoe && sameTile) return;
    this.hoverFoe = foe;
    this.hoverTile = next;
    this.highlightTile(foe ? foe.pos : next ?? this.waitingFor.pos);
    this.drawPreview();
  }

  /**
   * Free a captured ally the unit stands next to — the unit's Act (D60). No
   * auto-approach: walk adjacent yourself (lit tiles), then click to free.
   */
  private playerRescue(actor: Unit, captive: Unit): void {
    if (this.acted) return this.setHint(`${actor.name} has already acted — End Turn, then free ${captive.name} next turn.`);
    if (!isAdjacent(actor.pos, captive.pos)) {
      return this.setHint(`Move ${actor.name} onto a lit tile next to ${captive.name}, then click to free them.`);
    }
    this.busy = true;
    this.armedSkill = null;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.armedAim = null;
    // The rescue verb frees the captive and emits `unitRescued`; the bus listener owns the
    // token re-tint, the flash, and the combat-log line (the event drives the reaction).
    this.battle.rescue(captive, actor);
    this.noteAct();
    this.refreshHud();
    this.afterActionContinue(actor);
    if (!this.over) this.setHint(`${actor.name} freed ${captive.name}!`);
  }

  /**
   * Strike a foe in attack range — the unit's Act (D60). No auto-approach (the old
   * close-and-strike was the "slippery" feel): a foe out of range just prompts you
   * to step closer. The turn stays open afterward, so leftover move can still spend.
   */
  private playerAttack(actor: Unit, foe: Unit): void {
    if (this.acted) return this.setHint(`${actor.name} has already acted this turn — move, or End Turn (Space/W).`);
    if (!inAttackRange(actor, foe)) {
      return this.setHint(`${foe.name} is out of range — click a lit tile to move closer, then strike.`);
    }
    this.busy = true;
    this.armedSkill = null;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.armedAim = null;
    this.battle.attack(actor, foe);
    this.noteAct();
    this.flashAttack(actor, foe);
    this.refreshHud();
    this.afterActionContinue(actor);
  }

  /**
   * Undo **this unit's whole turn** in either phase (D60 / D63 — *Into the Breach*
   * take-back): roll the battle back to where the turn began through the shared action
   * log, then resync the board. Core reverts positions, HP, statuses, clock/charges, the
   * RNG cursor and the log ({@link "../../core/turn".Battle.undoAll}); the render re-reads
   * the result. The **resync loop is the shared spine** — only the per-turn flag-set and
   * the board re-read / action row branch by phase (the deploy turn refunds a placed
   * trap's marker and relights the reach; the combat turn re-reads strike reach + the HUD).
   * Combat additionally blocks a **trap-locked** turn (no take-back once a sprung trap cost
   * HP); both forbid it while an animation is mid-flight or with an empty log.
   */
  private undoTurn(actor: Unit, ctx: BoardCtx): void {
    if (this.busy || !this.battle.canUndo()) return;
    if (ctx === "deployment" ? this.deployActor !== actor : this.turnLocked || this.waitingFor !== actor) return;
    // Combat clears any armed target on take-back; deployment reaches undo only un-armed
    // (Esc cancels an aim first), so it has nothing to clear.
    if (ctx === "battle") {
      this.armedSkill = null;
      this.pendingHerb = null;
      this.bribeArmed = false;
    }
    this.battle.undoAll(); // core: positions, HP, statuses, clock/charges, RNG cursor, log
    // Per-turn render flags back to the turn's start (phase-specific sets).
    if (ctx === "deployment") {
      this.deployMoved = false;
      this.deployActed = false;
      this.deployReveal = false; // back to the minimal menu if the unit began the turn dug in
      this.moveBudget = moveBudget(actor); // the whole turn rolled back — full range again
      this.queuedTile = null;
    } else {
      this.moveBudget = moveBudget(actor);
      this.acted = false;
      this.actCharged = false;
      this.movedThisTurn = false;
    }
    // Resync every token's position + captured tint — the take-back may have moved /
    // revived / healed others. The one shared spine of the two undo paths.
    for (const u of this.battle.units) {
      this.placeView(u);
      if (u.side === "player") this.tintCaptured(u, u.captured);
    }
    if (ctx === "deployment") {
      this.syncPlayerTrapMarkers(); // drop the board marker for any undone trap (kit refunded in core)
      this.refreshSituationCard();
      this.highlightTile(actor.pos);
      this.refreshDeployButtons();
      this.refreshDeployStatus();
      this.recomputeReach(actor); // budget restored to full range — relight the reach (shared with battle)
      this.drawDeployReach();
      this.setHint(actor.dugIn
        ? `${actor.name}'s deploy turn reset — dug in again. Click a tile to move, Take Action to act in place, or End Turn (Space).`
        : `${actor.name}'s deploy turn reset — reposition, Dig In, place a trap, or End Turn (Space).`);
    } else {
      refreshAuras(this.battle.units); // confirm the tarpit ring matches the restored positions (D40)
      this.recomputeReach(actor);
      this.highlightTile(actor.pos);
      this.refreshHud();
      this.showSkillButtons(actor);
      this.drawPreview();
      this.setHint(`${actor.name}'s turn reset — take it again, or End Turn (Space/W).`);
    }
  }

  private afterTurn(): void {
    this.view.setActiveUnit(null);
    this.busy = false;
    this.movedThisTurn = false;
    this.acted = false;
    this.actCharged = false;
    this.turnLocked = false;
    this.hoverTile = null;
    this.hoverFoe = null;
    this.queuedTile = null;
    this.armedAim = null;
    this.reach = [];
    this.reachByKey.clear();
    this.resolveTheftDeaths();
    this.checkTrapSprings(); // a move may have sprung a hidden trap — reveal + mark it
    this.refreshHud();
    this.highlightTile(null);
    this.view.clearPreview(this.preview);
    // The turn's over — the primary button goes back to advancing the clock (D60).
    this.setPrimary("Advance Clock");
    // Graded poll (D50/D51): the fight can end on an objective even with foes alive.
    if (this.encounterDecided()) return this.finishBattle();
    this.setHint("Press Advance Clock for the next turn.");
  }

  // --- Resolution ------------------------------------------------------------

  private finishBattle(): void {
    if (this.over) return;
    this.over = true;
    this.phase = "resolution";
    this.legendStrip.setItems([]); // board key is meaningless under the result overlay
    this.focusCard.hide();
    this.railChevron?.setVisible(false);
    this.view.hideInitiative(); // clear the rail under the result overlay
    this.logChevron?.setVisible(false);
    this.view.setLogShown(false); // the feed is meaningless under the result overlay
    this.highlightTile(null);
    this.clearActionButtons();

    const goldEscaped = this.tallyEscapedThieves();
    const res = this.loop.resolve();
    const recruited = this.commitPendingRecruits();

    // Winning frees the field's captives (D52): an on-board captive recruit (the L1 Cook)
    // the player never reached is freed by the captors' fall — release the bound token so
    // the board reads coherently (un-greyed, full alpha) under the report. resolve() already
    // recruited him into the party; this only mirrors the freeing on his battle token.
    if (res.result === "win") {
      for (const u of this.battle.units) if (u.side === "player" && u.captured) freeCaptive(u);
    }

    this.refreshSituationCard();
    this.refreshUnits();
    this.refreshObjectives();
    // Re-tint any freed allies (roster + the just-freed board captives) — skip the dead so a
    // freed-then-downed captive keeps its death visual instead of recoloring to a live ally.
    for (const u of this.battle.units) if (u.side === "player" && u.alive && !u.captured) this.tintCaptured(u, false);

    const report = buildResolutionSummary({
      res,
      goldEscaped,
      recruited,
      units: this.battle.units,
      preBattleJobLevels: this.preBattleJobLevels,
      goldStolen: this.goldStolen,
      goldRecovered: this.goldRecovered,
      runComplete: this.loop.isComplete(),
    });
    showResolutionReport(this, this.overlay, report);
    this.setHint(`Resolution — ${report.title}. ${report.subtitle}`);
    // On any terminal (wipe / loss / run-complete) the overworld shows the end
    // screen; otherwise the player returns to the map to pick the next node.
    this.setPrimary(res.over ? (this.loop.isComplete() ? "See Results" : "Run Over") : "Return to Map");
    // Lift the action button above the report's dimming backdrop (depth 19) so it reads
    // crisp, not greyed — the one interactive element on the after-action screen.
    this.primary.setDepth(21);
  }

  /** Gold carried off by any thief still standing at the bell (D13/D21). */
  private tallyEscapedThieves(): number {
    let goldEscaped = 0;
    for (const [id, attempt] of this.theftAttempts) {
      if (attempt.resolved) continue;
      const thief = this.battle.units.find((u) => u.id === id);
      if (thief && thief.alive) goldEscaped += thiefEscapes(attempt);
    }
    return goldEscaped;
  }

  /**
   * Mid-combat bribe → recruitment (D33): permanent (authored) turncoats join the
   * guild roster after the battle; generics were temporary (just fought it out).
   * Returns the names that joined.
   */
  private commitPendingRecruits(): string[] {
    const recruited: string[] = [];
    if (this.guild) {
      for (const u of this.pendingRecruits) {
        if (recruitToRoster(this.guild, u)) recruited.push(u.name);
      }
    }
    return recruited;
  }

  /** Hand the run back to the overworld so the player can pick the next node. */
  private returnToOverworld(): void {
    // Soft-play (editor playtest): a `returnTo` scene key short-circuits the overworld — this run
    // is a throwaway one-node scenario, so return to the authoring surface, not a stub map (D-editor).
    if (this.returnTo) return void this.scene.start(this.returnTo);
    this.scene.start("OverworldScene", { run: this.run, loop: this.loop, guild: this.guild, caravanId: this.caravanId } as RunHandoff);
  }

  // --- Drawing helpers -------------------------------------------------------

  private tileToWorld(coord: GridCoord): { x: number; y: number } {
    return this.view.tileToWorld(coord);
  }

  private worldToTile(px: number, py: number): GridCoord {
    return this.view.worldToTile(px, py);
  }

  private drawGrid(): void {
    // Self-destroy the prior layer so this is re-callable mid-battle (a gate opening flips its tile
    // walkable, so the grid must redraw to drop that tile's obstacle block, D103). Depth 0 keeps it
    // under the zone washes (0.36+) and unit tokens (1).
    this.gridGfx?.destroy();
    const g = this.add.graphics().setDepth(0);
    this.gridGfx = g;
    this.view.drawGrid(g, this.grid);
  }

  private spawnUnits(): void {
    for (const unit of this.battle.units) {
      this.view.spawnUnit(unit);
      if (unit.captured) this.tintCaptured(unit, true);
    }
    this.view.refreshUnits();
  }

  private tintCaptured(unit: Unit, captured: boolean): void {
    const view = this.view.views.get(unit.id);
    if (!view) return;
    view.body.setFillStyle(captured ? COLOR.captive : COLOR.ally);
    view.body.setStrokeStyle(3, captured ? COLOR.captiveEdge : roleColor(unit, COLOR.allyEdge));
  }

  private placeView(unit: Unit): void {
    this.view.placeView(unit);
  }

  private refreshUnits(): void {
    this.view.refreshUnits();
  }

  private refreshHud(): void {
    this.drawRail(false);
    this.refreshUnits();
    this.refreshObjectives();
    this.refreshFocusCard();
  }

  /**
   * Draw the **initiative rail** (CombatView) docked **bottom-right** and **bottom-anchored** —
   * it grows upward as it expands, so it never runs off the bottom — with the "Turn order" label +
   * expand chevron above its top chip. In **deployment** it shows the **player units + the net**
   * (the concealed foes are filtered out, and the net rides in as a CT row so the player can read
   * when the next capture step lands); in **battle** it's the full roster.
   */
  private drawRail(deploy: boolean): void {
    this.orderText.setText("Turn order");
    const limit = this.railExpanded ? undefined : BattleScene.RAIL_COLLAPSED;
    const railX = this.scale.width - 158;
    const railBottom = this.scale.height - 48; // clear of the bottom-right Session-log chip
    const tempo = deploy ? this.battle.clock.tempoState() : undefined;
    const opts = deploy
      ? { filter: (u: Unit) => u.side === "player", tempo: tempo ? { name: "The net", ct: tempo.ct } : undefined }
      : {};
    const rail = this.view.drawInitiative(this.battle.units, railX, 0, (u) => this.battle.clock.isCharging(u), limit, railBottom, opts);
    this.orderText.setPosition(railX, rail.topY - 15);
    this.layoutRailChevron(rail);
  }

  /** Collapse/expand the centre-bottom combat-log feed (the chevron's toggle). */
  private toggleLog(): void {
    this.logCollapsed = !this.logCollapsed;
    this.view.setLogShown(!this.logCollapsed);
    this.logChevron?.setText(this.logCollapsed ? "▸  Log" : "▾  Log");
  }

  /**
   * Place the rail's expand/collapse chevron beside the "Turn order" label (above the top
   * chip) — the rail is bottom-anchored, so there's no room below it for the chevron, and the
   * very bottom-right corner is taken by the Session-log chip. Shown only when the rail
   * overflows the collapsed cap; clicking toggles {@link railExpanded} and redraws.
   */
  private layoutRailChevron(rail: { total: number; shown: number; topY: number; bottomY: number }): void {
    const hidden = rail.total - rail.shown;
    const collapsible = rail.total > BattleScene.RAIL_COLLAPSED;
    if (!collapsible) return void this.railChevron?.setVisible(false);
    if (!this.railChevron) {
      this.railChevron = this.add
        .text(0, 0, "", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption })
        .setDepth(10)
        .setInteractive({ useHandCursor: true });
      this.railChevron.on(Phaser.Input.Events.POINTER_DOWN, () => { this.railExpanded = !this.railExpanded; this.refreshHud(); });
      this.railChevron.on(Phaser.Input.Events.POINTER_OVER, () => this.railChevron?.setColor(INK.bright));
      this.railChevron.on(Phaser.Input.Events.POINTER_OUT, () => this.railChevron?.setColor(INK.muted));
    }
    const label = this.railExpanded ? "▴ less" : `▾ ${hidden} more`;
    this.railChevron.setText(label).setPosition(this.scale.width - 158 + 86, rail.topY - 15).setVisible(true);
  }

  /**
   * The **objectives check-list** (D50) — a vertically stacked box (top-centre, styled like
   * the action box) listing every staged objective with a left-hand status marker: a green
   * **✓** when met, a red **✗** when failed, else a muted **○** (with the live % appended for a
   * timed one). Generic over the staged objectives — incl. the default "Defeat all enemies"
   * goal, so the box is always populated — so any objective feature shows up in every fight
   * that has it. Rebuilt each refresh; nothing drawn if (somehow) there are no objectives.
   */
  private refreshObjectives(): void {
    clearLayer(this.objectiveObjects);
    const objs = this.loop.staged?.objectives ?? [];
    if (objs.length === 0) return;
    const rows = objs.map((o) => {
      const status = o.status();
      const prog = o.progress();
      if (status === "met") return { marker: ICON.check.glyph, color: ICON.check.color, label: o.spec.label };
      if (status === "failed") return { marker: ICON.failed.glyph, color: ICON.failed.color, label: o.spec.label };
      const pct = prog !== undefined ? `  ${Math.round(prog * 100)}%` : "";
      return { marker: ICON.open.glyph, color: ICON.open.color, label: o.spec.label + pct };
    });

    // Far-left, directly under the top-left phase/turn line (x matches the title's 12px inset) —
    // a left-column "mission" stack above the focus card.
    const padX = 10, padY = 7, rowPitch = 18, markerGap = 8, top = 28, left = 12;
    // Measure the widest label (off-screen) to size the box to its content, like the action box.
    const labelW = Math.max(40, ...rows.map((r) => probeWidth(this, r.label, FONT.label)));
    const markerW = 10;
    const boxW = padX * 2 + markerW + markerGap + labelW;
    const boxH = padY * 2 + 16 + (rows.length - 1) * rowPitch;

    this.objectiveObjects.push(
      this.add.rectangle(left + boxW / 2, top + boxH / 2, boxW, boxH, COLOR.surface, 0.85).setStrokeStyle(1, COLOR.borderSoft).setDepth(10),
    );
    rows.forEach((r, i) => {
      const y = top + padY + 8 + i * rowPitch;
      this.objectiveObjects.push(
        this.add.text(left + padX, y, r.marker, { color: r.color, fontFamily: FONT.family, fontSize: FONT.label, fontStyle: WEIGHT.bold }).setOrigin(0, 0.5).setDepth(11),
        this.add.text(left + padX + markerW + markerGap, y, r.label, { color: r.color, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(11),
      );
    });
  }

  /** True once the staged encounter has reached a graded terminal (D50/D51). */
  private encounterDecided(): boolean {
    return !this.loop.staged || encounterOutcome(this.loop.staged) !== undefined;
  }

  /** Reveal hidden ambush bodies the party can now see (the scouting payoff, D44). */
  private revealScouted(): void {
    let revealed = false;
    for (const u of this.battle.units) {
      if (u.hidden && u.alive && canSee(this.battle.units, "player", u.pos)) {
        u.hidden = false;
        revealed = true;
        this.setHint(`Ambush revealed — ${u.name} springs from cover!`);
      }
    }
    if (revealed) this.refreshUnits(); // refreshUnits re-reads hidden → un-fades the token
  }

  /** The live read the {@link situationCard} renders from — a fresh snapshot each refresh. */
  private situationCtx(): SituationCtx {
    return {
      run: this.run,
      phase: this.phase,
      intel: this.intel,
      // High morale trims open-ground capture risk in Deployment (D-UX) — pass the applied
      // multiplier where it lands, 1 elsewhere, so the camp card reads "High (−20% open risk)".
      openRiskMultiplier: this.phase === "deployment" ? this.moraleMods().exposureMultiplier : 1,
    };
  }

  /** Re-render the top-right situation card (Camp **or** Intel) — delegates to {@link situationCard}. */
  private refreshSituationCard(): void {
    this.situationCard.refresh();
  }

  /** Flip the situation card to Camp or Intel — exposed for the e2e harness (`s.setCardView`). */
  setCardView(view: CardView): void {
    this.situationCard.setView(view);
  }

  /**
   * The left-column **active-unit focus** card — the decision zone (D-UX): who's
   * acting, their HP, and the figures that drive *this* phase's choice. In Deployment
   * that's the capture risk + position band (emphasised, pulled out of the title); in
   * Battle it's the move/Act budget. The "change if I act" deltas layer on next.
   */
  private refreshFocusCard(): void {
    const actor = this.phase === "deployment" ? this.deployActor : this.waitingFor;
    if (!actor) {
      this.focusCard.hide();
      return;
    }
    const rows: CardRow[] = [];
    // Lead with the unit's job: the action menu lists *this unit's* job verbs, so naming
    // the job is what makes "which ability is enabled by who" legible. The job level rides
    // along because it's *why* a unit has one active vs. two (the 2nd unlocks at L2, D39).
    const job = getJob(primaryJobOf(actor));
    if (job) rows.push({ label: "Role", value: `${job.name} L${jobLevelOf(actor, primaryJobOf(actor))}`, color: INK.secondary });
    if (this.phase === "deployment") {
      const dug = actor.dugIn === true;
      const protectedHere = !!this.campfire && isProtected(actor.pos, this.campfire);
      const inNet = !!this.front && inDangerZone(actor.pos, this.front);
      const band = actor.captured ? "Captured" : protectedHere ? "Safe" : inNet ? "In the net" : dug ? "Dug in" : "Exposed";
      // Protected ground is genuinely safe (green); the net is near-certain capture;
      // open ground is a real risk now, so "Exposed" reads as a warning, not neutral.
      const bandColor = actor.captured || inNet ? INK.danger : protectedHere || dug ? INK.success : INK.ember;
      rows.push({ label: "Position", value: band, color: bandColor });
      // Remaining step budget this turn (deployment moves tile-by-tile now) — so the
      // player can see they may keep stepping before they End Turn.
      if (!actor.captured) rows.push({ label: "Move left", value: `${this.moveBudget}`, color: this.moveBudget > 0 ? INK.secondary : INK.muted });
      if (!actor.captured && protectedHere) {
        // Short value: "safe in camp" was wide enough to collide with the "Capture risk"
        // label in the narrow focus card (a visual-audit finding). "none" matches the
        // capture-risk wording the forecast card already uses on protected ground, and
        // the "Position: Safe" row above still carries the in-camp reason.
        rows.push({ label: "Capture risk", value: "none", color: INK.success });
      } else if (!actor.captured && this.front && this.campfire) {
        // Hot decision: forecast each choice's capture risk (D48 route-forecast ethos),
        // so the card answers "what should this unit do *now*", not just "how bad is it".
        // Repositioning stays on the table while move budget remains this turn.
        const reach = this.moveBudget > 0 ? reachableTiles(actor, this.battle.units, this.grid, this.moveBudget).map((r) => r.tile) : [];
        const fc = deployForecast(actor, this.campfire, this.front, reach, { dugIn: dug, exposureMultiplier: this.deployMods().exposureMultiplier });
        const pct = (n: number) => `${Math.round(n * 100)}%`;
        rows.push({ label: "Hold", value: pct(fc.hold), color: INK.danger, emphasize: true });
        if (fc.digIn !== null) rows.push({ label: "Dig in", value: pct(fc.digIn), color: INK.success });
        if (fc.move !== null) rows.push({ label: "Move", value: fc.move <= 0 ? "safe" : pct(fc.move), color: INK.success });
      }
    } else {
      rows.push({ label: "Move left", value: `${this.moveBudget}`, color: this.moveBudget > 0 ? INK.secondary : INK.muted });
      rows.push({ label: "Action", value: this.acted ? "spent" : "ready", color: this.acted ? INK.muted : INK.success });
      // Centralise the active unit's statuses here (the active-unit zone) — otherwise
      // they read only as tiny board pips + rail glyphs. Tinted by net valence.
      if (actor.statuses.length > 0) {
        const harmful = actor.statuses.some((s) => s.kind === "debuff");
        const helpful = actor.statuses.some((s) => s.kind === "buff");
        rows.push({
          label: "Status",
          value: actor.statuses.map((s) => s.name).join(", "),
          color: harmful ? INK.danger : helpful ? INK.success : INK.muted,
        });
      }
    }
    this.focusCard.set(actor.name, rows, { frac: actor.maxHp > 0 ? actor.hp / actor.maxHp : 0, cur: actor.hp, max: actor.maxHp });
  }

  private setHint(text: string): void {
    this.lastHint = text;
    this.hintPanel.setResting(text);
  }

  /** Paint the active player unit's move/attack (or armed-skill target) preview. */
  private drawPreview(): void {
    const actor = this.waitingFor;
    if (!actor || this.busy || this.over || this.phase !== "battle") {
      this.view.clearPreview(this.preview);
      this.threatGfx.clear();
      this.refreshAuras();
      this.previewCtl.hide();
      return;
    }
    if (this.showThreat) this.view.drawThreatZone(this.threatGfx, this.battle.units, this.grid, "player");
    else this.threatGfx.clear();
    this.refreshAuras();
    const hoverPath = this.hoverTile ? this.reachByKey.get(`${this.hoverTile.col},${this.hoverTile.row}`)?.path : undefined;
    this.view.drawPreview(this.preview, actor, this.battle.units, this.grid, {
      armed: this.armedSkill ?? undefined,
      armedAim: this.armedAim ?? undefined,
      intoTrap: (c) => this.trapAt(c),
      moveBudget: this.moveBudget,
      acted: this.acted,
      hoverPath,
    });
    this.refreshPreviewCard();
  }

  /** Re-paint the persistent tarpit aura — drawn in Deployment and Battle alike (D64). */
  private refreshAuras(): void {
    if (this.over || (this.phase !== "battle" && this.phase !== "deployment") || !this.grid || !this.battle) {
      this.auraGfx?.clear();
      return;
    }
    this.view.drawAuras(this.auraGfx, this.battle.units, this.grid);
  }

  /** Does an *armed* (un-sprung) trap stand on this tile? — the push-into-trap read (D64 follow-up #2). */
  private trapAt(c: GridCoord): boolean {
    return this.battle.entities.at(c).some((e) => isConcealedTrap(e) && !e.sprung);
  }

  /**
   * Route the docked **preview card** ("what happens if I commit?") to the right read for
   * the current hover/selection, handing {@link PreviewCardController} the resolved live
   * inputs. In Battle: an armed ability's forecast (D64); else the hovered enemy's deal /
   * hits-back; else the hovered move tile's cost + tiles-left. In Deployment: the hovered
   * tile's capture risk. Hidden when there's nothing to preview.
   */
  private refreshPreviewCard(): void {
    if (this.phase === "battle") {
      const actor = this.waitingFor;
      if (!actor || this.busy || this.over) return this.previewCtl.hide();
      if (this.armedSkill) return this.previewCtl.showAbilityForecast(actor, this.armedSkill, this.armedAim, this.battle.units, this.run.inventory, this.run.camp.morale);
      if (this.hoverFoe && this.hoverFoe.alive && !this.hoverFoe.hidden) return this.previewCtl.showAttackPreview(actor, this.hoverFoe, this.battle.units);
      if (this.hoverTile) return this.previewCtl.showMovePreview(this.reachByKey.get(`${this.hoverTile.col},${this.hoverTile.row}`), this.moveBudget, this.acted);
      return this.previewCtl.hide();
    }
    if (this.phase === "deployment") {
      const actor = this.deployActor;
      if (!actor || this.busy || actor.captured || this.armedSkill || !this.deployHoverTile) return this.previewCtl.hide();
      return this.previewCtl.showDeployPreview(actor, this.deployHoverTile, this.campfire, this.front, this.deployMods().exposureMultiplier);
    }
    this.previewCtl.hide();
  }

  /** The hovered-foe deal/hits-back rows — a thin wrapper over the pure {@link
   *  computeAttackPreviewRows} formatter, exposed for the e2e harness (`s.attackPreviewRows`). */
  attackPreviewRows(actor: Unit, foe: Unit): CardRow[] {
    return computeAttackPreviewRows(actor, foe, this.battle.units);
  }

  private highlightTile(coord: GridCoord | null): void {
    this.view.highlightTile(this.highlight, coord);
  }

  // --- Command menu (thin delegators to CommandMenu, #131) -------------------

  /** Set the green primary's label/visibility (End Turn / Advance Clock / …). */
  private setPrimary(text: string, visible = true): void {
    this.menu.setPrimary(text, visible);
  }

  /** Tear the command menu down and float the primary back to its lone resting spot. */
  private clearActionButtons(): void {
    this.menu.clear();
  }

  /** Lay the two stacked verb/turn-control boxes from spec rows (see {@link CommandMenu.layout}). */
  private layoutActionMenu(verbs: ActionSpec[], opts: { undo?: ActionSpec; controls?: ActionSpec[] } = {}): void {
    this.menu.layout(verbs, opts);
  }

  // --- Animation -------------------------------------------------------------

  private animateMove(unit: Unit, path: readonly GridCoord[], done: () => void): void {
    this.view.animateMove(unit, path, done, 150 / this.turnSpeed);
  }

  private flashAttack(attacker: Unit, target: Unit): void {
    this.view.flashHit(attacker, target);
  }

  private flashHeal(unit: Unit): void {
    this.view.flashHeal(unit);
  }
}
