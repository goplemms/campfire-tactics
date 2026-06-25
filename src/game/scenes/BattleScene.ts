import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import { roleColor } from "../roles";
import { CombatView } from "../combat-view";
import { addVignette } from "../vignette";
import {
  type ResolveResult,
  findPath,
  occupiedGrid,
  reachableTiles,
  moveBudget,
  isImmobilized,
  inAttackRange,
  computeDamage,
  refreshAuras,
  isAdjacent,
  TileGrid,
  TILE_HEIGHT,
  Battle,
  unlockedSkills,
  availableSkills,
  getJob,
  primaryJobOf,
  onSkillCooldown,
  DEFEND,
  isValidSkillTarget,
  canSee,
  // M5b/D11 — deployment: the shared stealth-alert model
  countOf,
  campReadout,
  freeCaptive,
  streamFor,
  // D63 — the closing net: two radial influence sources. The party's campfire
  // (safe ground, sized by presence) vs. the enemy source (danger, growing on the
  // deployment clock); the danger overrides the campfire, shrinking your territory.
  createFront,
  createCampfire,
  DeployClock,
  resolveFrontTurn,
  inDangerZone,
  inSafeZone,
  isProtected,
  captureChanceAt,
  captureEvasionFactor,
  stepDistance,
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
  isAuthoredEncounter,
  encounterOutcome,
  jobLevelOf,
  // M10 — theft (D30) + mid-combat bribe → recruitment (D33)
  thiefSteal,
  recoverStolen,
  thiefEscapes,
  previewNode,
  scoutedTier,
  // D10 — the intel deploy edge: scouted ground deploys safer
  intelFloor,
  clampTier,
  intelDeployBonus,
  // D12 — the enemy trap-field: spot, search, and Survivalist disarm
  isConcealedTrap,
  hiddenTraps,
  revealTrapsNear,
  spotWhileMoving,
  disarmTrap,
  canDisarm,
  type ConcealedTrap,
  type PlaceTrapEffect,
  bribeEnemy,
  bribeCost,
  bribeChance,
  influenceTier,
  recruitToRoster,
  type RunState,
  type RunLoop,
  type IntelReport,
  type IntelTier,
  type DeployFront,
  type DeploySource,
  type Rng,
  forecastSkill,
  aimInRange,
  type GridCoord,
  type Unit,
  type Side,
  type SkillDef,
  type TheftAttempt,
  type AbilityForecast,
} from "../../core";
import type { RunHandoff } from "./OverworldScene";
import { Button } from "../button";
import { isScreenshotMode, clearLayer } from "../ui";
import { HintPanel } from "../hint-panel";
import { LegendStrip, DEPLOY_LEGEND, BATTLE_LEGEND } from "../legend-strip";
import { MiniCard, type CardRow } from "../info-cards";
import { dropNet as dropNetCage } from "../deploy-fx";
import { ICON, type IconKey, type IconSpec } from "../icons";

/**
 * Board zoom for the real combat field (D-UX): enlarge tiles + tokens so details
 * (HP bars, nameplates, status pips) stand out — the procedural 8×6 board is
 * centred full-width and has the room. Applied via {@link CombatView.boardScale}.
 */
const BOARD_SCALE = 1.4;

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

/** One icon-led line in a resolution section — an outcome and the colour it reads as. */
interface ReportRow {
  /** Registry icon keying the row's glyph + default tint; omit for a plain bullet. */
  icon?: IconKey;
  text: string;
  /** Text colour override (the row's valence), else the section default. */
  color?: string;
}

/** A titled group of {@link ReportRow}s — dropped entirely when it has no rows. */
interface ReportSection {
  heading: string;
  rows: ReportRow[];
}

/** The full after-action report: a toned headline + subtitle over grouped sections. */
interface ResolutionReport {
  title: string;
  good: boolean;
  subtitle: string;
  sections: ReportSection[];
}

/** Command-menu geometry (the bottom-left stacked action box) — shared so the docked
 *  primary and the verb stack agree on width/pitch/anchor. */
const MENU_BW = 150;
const MENU_BH = 28;
const MENU_PITCH = 31;
const MENU_PAD = 7;
const MENU_LEFT = 12; // box left margin
const MENU_CX = MENU_LEFT + MENU_PAD + MENU_BW / 2; // button centre x (bottom-left)

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
  private originX = 0;
  private originY = 0;
  /** Shared board geometry + grid/tile drawing (the converged combat presentation). */
  private view!: CombatView;

  // Persistent HUD.
  private titleText!: Phaser.GameObjects.Text;
  private intelText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private orderText!: Phaser.GameObjects.Text;
  /** Active-unit focus card (left, the decision zone) + the peripheral camp-state card. */
  private focusCard!: MiniCard;
  private campCard!: MiniCard;
  /**
   * The docked **preview card** — the "before you commit" read (docked just under the
   * focus card): the armed-ability forecast (D64), or, on hover, the move-tile (cost +
   * tiles left), the enemy (deal + hits-back), or the deploy-tile (capture risk).
   */
  private previewCard!: MiniCard;
  /** Initiative rail collapse (D-UX): show the soonest few, chevron to reveal the rest. */
  private static readonly RAIL_COLLAPSED = 3;
  private railExpanded = false;
  private railChevron?: Phaser.GameObjects.Text;
  private hintPanel!: HintPanel;
  /** The always-on board colour key (safe/danger washes), set per phase. */
  private legendStrip!: LegendStrip;
  private lastHint = "";
  private primary!: Button;
  private actionButtons: Phaser.GameObjects.GameObject[] = [];
  private overlay: Phaser.GameObjects.GameObject[] = [];
  /** The toggleable Legend & Keys panel (L) — empty when hidden. */
  private legend: Phaser.GameObjects.GameObject[] = [];

  // Deployment state (D11): the active unit + a seeded roll stream for the net.
  private deployActor: Unit | null = null;
  private deployRng!: Rng;
  // D63 — the closing net: an advancing enemy danger front, a deployment-phase CT
  // clock that interleaves player turns with the front's, and the dug-in stance set.
  private dangerZoneGfx?: Phaser.GameObjects.Graphics;
  /** The party's campfire (safe ground) and the enemy danger source (D63). */
  private campfire!: DeploySource;
  private front!: DeployFront;
  /** On-board source markers (campfire + enemy), cleared when battle begins. */
  private deployMarkers: Phaser.GameObjects.GameObject[] = [];
  private deployClock!: DeployClock;
  /** What the active deploy unit has done this turn — drives the End-Turn CT spend. */
  private deployMoved = false;
  private deployActed = false;
  /** The party's Set Trap spec (damage + snare status), resolved at deploy; undefined = no trapper. */
  /** Board markers for the player's own placed traps, keyed by the registered entity id. */
  private playerTrapMarkers = new Map<string, Phaser.GameObjects.Text>();
  private trapSeq = 0;
  // D12 — concealed enemy traps: a seeded spot-roll stream + per-trap board markers.
  private spotRng!: Rng;
  private trapMarkers = new Map<string, Phaser.GameObjects.Text>();
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
  /** Movement still in the budget this turn (tiles); 0 once spent or Immobilized. */
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
  }

  create(): void {
    this.view = new CombatView(this);
    // Enlarge the combat field for legibility (D-UX): bigger tiles + tokens (HP
    // bars, nameplates, status pips) so details stand out, especially in testing.
    // The procedural board is 8×6 and centred full-width, so it has room to grow.
    this.view.boardScale = BOARD_SCALE;
    this.view.reduceMotion = isScreenshotMode();
    // The campfire glow — a warm vignette over the board, beneath the tokens/HUD.
    addVignette(this);
    // Persistent UI.
    // Top strip = "the situation": a prominent heading (phase + whose turn) over a
    // single secondary line that composes the objective (the goal — leads) and the
    // intel recap (passive reference — trails), laid out together by layoutSituationLine
    // so the band stays two lines instead of three (D-UX compactness).
    this.titleText = this.add.text(this.scale.width / 2, 16, "", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.title }).setOrigin(0.5).setDepth(10);
    this.intelText = this.add.text(this.scale.width / 2, 42, "", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5).setDepth(10);
    // Objective readout (label + gauge) — shares the secondary line, ahead of intel.
    this.objectiveText = this.add.text(this.scale.width / 2, 42, "", { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.body, align: "center" }).setOrigin(0.5).setDepth(11);
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
    this.previewCard = new MiniCard(this, 8, 184, { w: 150 }).hide();
    this.campCard = new MiniCard(this, this.scale.width - 158, 42, { w: 150 });
    this.hintPanel = new HintPanel(this);
    // The persistent board colour key — the same component carries across phases,
    // re-keyed in enterDeploy / startBattle so the wash language is always legible.
    this.legendStrip = new LegendStrip(this);
    this.threatGfx = this.add.graphics().setDepth(0.36);
    // The tarpit-aura ring (D64) sits just above the zone washes but below the move/
    // footprint preview, so a Heavy Knight's taxed tiles read in both phases.
    this.auraGfx = this.add.graphics().setDepth(0.38);
    this.preview = this.add.graphics().setDepth(0.4);
    this.highlight = this.add.graphics().setDepth(0.5);
    this.primary = this.makeTextButton(MENU_CX, this.scale.height - 40, MENU_BW, MENU_BH, "", COLOR.successDeep, COLOR.success, () => this.onPrimary());
    this.primary.setDepth(12);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    // Hover routing (D60): light the path to the tile under the cursor as it moves.
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    // Keyboard shortcuts (D55 QoL): one handler routes every key — see onKey / the
    // Legend (L) for the full list. The harness sets __SHOT__ for headless captures.
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => this.onKey(e));

    this.startCombatNode();
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
    this.over = false;
    this.busy = false;
    this.waitingFor = null;
    this.armedSkill = null;
    this.deployActor = null;
    this.playerTrapMarkers.clear();
    this.trapSeq = 0;
    this.pendingHerb = null;
    this.objectiveText.setText("");
    this.rebuildBoard();

    // Intel read (D10), then straight into Deployment.
    this.intel = this.loop.intel();
    this.refreshCampText();
    this.refreshIntelText();
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
    clearLayer(this.deployMarkers);
    this.highlight.clear();
    this.view.clearPreview(this.preview);
    this.threatGfx.clear();

    this.originX = this.scale.width / 2;
    this.originY = this.scale.height / 2 - (this.grid.rows * TILE_HEIGHT * BOARD_SCALE) / 2 + 4;
    this.view.setOrigin(this.originX, this.originY);

    this.drawGrid();
    this.spawnUnits();
  }

  // --- Phase: Deployment -----------------------------------------------------

  private enterDeploy(): void {
    this.phase = "deployment";
    // The foe is pre-positioned but unseen during staging (D12) — veil enemy tokens
    // now; startBattle lifts it. Refresh re-applies the veil after spawnUnits.
    this.view.concealEnemies = true;
    this.view.refreshUnits();
    this.legendStrip.setItems(DEPLOY_LEGEND);
    this.deployRng = streamFor(this.run.seed, "deploy");
    this.spotRng = streamFor(this.run.seed, "trap-spot");
    this.trapMarkers.clear();
    this.playerTrapMarkers.clear();
    this.trapSeq = 0;
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
    this.deployClock = new DeployClock(this.battle.units, this.front);
    this.deployClock.seed();
    this.drawZones();
    this.drawSourceMarkers();
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
    const turn = this.deployClock.next();
    if (turn.isFront || !turn.unit) this.runFrontTurn();
    else this.beginDeployTurn(turn.unit);
  }

  /** Open one player unit's deployment turn: it may move, dig in, or set a trap. */
  private beginDeployTurn(unit: Unit): void {
    this.deployMoved = false;
    this.deployActed = false;
    this.deployHoverTile = null;
    // Arm the shared action-log undo for the deploy turn (D63) — each move/dig-in/
    // trap becomes undoable back to the turn's start, exactly like a combat turn.
    this.battle.beginUndo();
    // The active unit looks around as it steps up — a passive Awareness scan may spot
    // nearby traps (D12 parity with the combat turn-open). Reveal *before* the buttons
    // render so a freshly-spotted adjacent trap surfaces its Disarm verb this turn.
    const spotted = hiddenTraps(this.battle.entities).length > 0
      ? revealTrapsNear(unit, this.battle.entities, this.spotRng)
      : [];
    if (spotted.length > 0) this.redrawTrapMarkers();
    this.selectDeployActor(unit);
    this.setPrimary("End Turn");
    const trapsAfield = hiddenTraps(this.battle.entities).length > 0 || this.trapMarkers.size > 0;
    this.setHint(
      `${unit.name}'s turn — click a tile to reposition, Dig In, or place a trap, then End Turn (Space). ` +
        (spotted.length > 0 ? `Spots ${spotted.length} hidden trap${spotted.length > 1 ? "s" : ""} (${ICON.trapArmed.glyph})! ` : "") +
        (trapsAfield ? `Search to scan further, or a trapper can Disarm. ` : "") +
        `The enemy's reach is ${this.front.radius} step${this.front.radius === 1 ? "" : "s"} and growing.`,
    );
  }

  /** Between deploy turns the clock rests on the player — Advance Clock steps it. */
  private enterDeployIdle(hint: string): void {
    this.deployActor = null;
    this.highlightTile(null);
    this.setPrimary("Advance Clock");
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint(hint);
  }

  /**
   * Resolve the front's turn (D63): the net advances one column, then rolls capture
   * for every unit it has swallowed. The first capture raises the alarm and battle
   * begins; if the net overruns the camp's home edge with nobody caught, battle
   * begins anyway. Otherwise the clock rests on the player until the next Advance.
   */
  private runFrontTurn(): void {
    // resolveFrontTurn reads each unit's dugIn stance by default (D63); the morale/intel
    // deploy edge rides in as the neutral-capture multiplier (D8/D10).
    const out = resolveFrontTurn(this.front, this.campfire, this.battle.units, this.deployRng, {
      exposureMultiplier: this.deployMods().exposureMultiplier,
    });
    this.deployClock.spendFront();
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
    this.battle.endUndo(); // the deploy turn commits — no take-back across the boundary
    this.deployClock.spend(unit, { moved: this.deployMoved, acted: this.deployActed });
    this.enterDeployIdle(`${unit.name}'s turn ends — Advance Clock (Space) to step the net, or Start Battle.`);
  }

  /**
   * Undo **this unit's whole deploy turn** (D63 — the deploy twin of the combat
   * D60 take-back): roll the battle back through the shared action log to where the
   * turn began — repositions, dig-in, and any placed trap (its kit refunded, its
   * entity dropped) — then resync the board. The clock/RNG/log revert in core
   * ({@link "../../core/turn".Battle.undoAll}); the render re-reads the result.
   */
  private undoDeployTurn(actor: Unit): void {
    if (this.busy || this.deployActor !== actor || !this.battle.canUndo()) return;
    this.battle.undoAll();
    this.deployMoved = false;
    this.deployActed = false;
    // Resync token positions + captured tint, then drop markers for any undone trap.
    for (const u of this.battle.units) {
      this.placeView(u);
      if (u.side === "player") this.tintCaptured(u, u.captured);
    }
    this.syncPlayerTrapMarkers();
    this.refreshCampText();
    this.highlightTile(actor.pos);
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint(`${actor.name}'s deploy turn reset — reposition, Dig In, place a trap, or End Turn (Space).`);
  }

  /** Destroy board markers for player traps no longer registered (after an undo). */
  private syncPlayerTrapMarkers(): void {
    for (const [id, m] of this.playerTrapMarkers) {
      if (!this.battle.entities.all().some((e) => e.id === id)) {
        m.destroy();
        this.playerTrapMarkers.delete(id);
      }
    }
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

  /** The node's effective intel tier (passive floor + scouting), for the deploy edge (D10). */
  private intelTier(): IntelTier {
    return clampTier(intelFloor(this.run.party) + scoutedTier(this.run.overworld, this.run.mapNodeId));
  }

  /**
   * Deploy modifiers = morale (D8) folded with the intel edge (D10): scouted
   * ground widens the safe depth and lowers exposure, on top of the morale bundle.
   */
  private deployMods() {
    const m = this.moraleMods();
    const intel = intelDeployBonus(this.intelTier());
    return {
      ...m,
      safeDepthBonus: m.safeDepthBonus + intel.safeDepthBonus,
      exposureMultiplier: m.exposureMultiplier * intel.exposureMultiplier,
    };
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
    const specs: { text: string; description?: string; onClick: () => void }[] = [];
    // Meta-controls (pure decision, D63/D67): Undo leads when there's something to take back.
    const ids = deployActions({ hasActor: !!actor, captured: !!actor?.captured, canUndo: this.battle.canUndo() });
    if (ids.includes("undo") && actor) {
      specs.push({
        text: "Undo",
        description: "Take back everything this unit did this deploy turn — moves, dig-in, traps (kit refunded) — back to where it started (Esc).",
        onClick: () => this.undoDeployTurn(actor),
      });
    }
    // The ability buttons are the **same data-driven projection as combat** (D67): the unit's
    // pre-combat skills + the universal Dig In / Defend, from availableSkills — so a Set-Trap
    // skill surfaces because it's pre-combat *data*, not via a hand-computed `canTrap`.
    if (actor && !actor.captured && !this.deployActed) {
      for (const skill of availableSkills(actor, "pre-combat")) {
        const text = skill.effect.kind === "placeTrap" ? "Place Trap Here" : skill.name;
        specs.push({ text, description: skill.description, onClick: () => this.onDeploySkillButton(actor, skill) });
      }
      // Trap-field verbs (D12) carried into Deployment: Search scans the ground ahead,
      // and a trapper Disarms a spotted, adjacent trap — both spend the unit's act.
      if (hiddenTraps(this.battle.entities).length > 0) {
        specs.push({
          text: "Search",
          description: "Spend this unit's act scanning the ground ahead for concealed traps (a wider, better look).",
          onClick: () => this.doDeploySearch(actor),
        });
      }
      const adjTrap = this.adjacentRevealedTrap(actor);
      if (adjTrap && canDisarm(actor)) {
        specs.push({
          text: "Disarm trap",
          description: "Disarm the adjacent spotted trap and pocket its kit (a trap-trained unit only).",
          onClick: () => this.doDeployDisarm(actor, adjTrap.id),
        });
      }
    }
    // Start Battle always closes the row (commit early at any point).
    specs.push({
      text: "Start Battle",
      description: "Commit now — begin the fight with the party where it stands.",
      onClick: () => { if (!this.busy) this.startBattle(); },
    });
    this.layoutActionMenu(specs);
  }

  /**
   * Route a surfaced deploy ability to its verb (D67): a trap keeps the place-trap flow,
   * Dig In its hunker verb, a self-cast resolves immediately, and a targeted ability arms
   * for a click — all the same `availableSkills` projection the buttons came from.
   */
  private onDeploySkillButton(actor: Unit, skill: SkillDef): void {
    if (this.busy || this.deployActor !== actor || actor.captured || this.deployActed) return;
    if (skill.effect.kind === "placeTrap") return this.placeTrap(skill.effect);
    if (skill.id === "dig-in") return this.digIn();
    if (skill.target === "self") return this.castDeploySkill(actor, skill, actor);
    this.armedSkill = skill;
    this.setHint(`${skill.name}: click a valid target (or click ${actor.name} to cancel).`);
  }

  /**
   * Cast a dual-context ability during Deployment through the drained `deploySkill` verb
   * (D67) — logged + undoable, with no CT commit. It spends the unit's **act**, leaving its
   * **move** free, so a Dash → reposition combo works pre-combat just like in battle.
   */
  private castDeploySkill(actor: Unit, skill: SkillDef, target: Unit): void {
    if (this.busy || actor.captured || this.deployActed) return;
    this.armedSkill = null;
    this.battle.deploySkill(actor, skill, target);
    this.deployActed = true;
    this.refreshAuras();
    for (const u of this.battle.units) this.placeView(u);
    this.highlightTile(actor.pos);
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint(`${actor.name} used ${skill.name}. Reposition or End Turn (Space) to advance the net.`);
  }

  /** Deployment Search (D12) — spend the unit's act on a wider, better trap scan. */
  private doDeploySearch(actor: Unit): void {
    if (this.busy || this.deployActor !== actor || actor.captured || this.deployActed) return;
    const found = revealTrapsNear(actor, this.battle.entities, this.spotRng, { search: true });
    if (found.length > 0) this.redrawTrapMarkers();
    this.deployActed = true;
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint(found.length > 0
      ? `${actor.name} searches and spots ${found.length} hidden trap${found.length > 1 ? "s" : ""} (${ICON.trapArmed.glyph}). Reposition or End Turn.`
      : `${actor.name} searches but turns up nothing here. Reposition or End Turn.`);
  }

  /** Deployment Disarm (D12) — a trapper clears a spotted adjacent trap, pocketing its kit. */
  private doDeployDisarm(actor: Unit, trapId: string): void {
    if (this.busy || this.deployActor !== actor || actor.captured || this.deployActed) return;
    const res = disarmTrap(this.battle.entities, trapId, actor, this.run.inventory);
    if (!res.ok) return this.setHint(`Can't disarm: ${res.reason}`);
    this.redrawTrapMarkers();
    this.refreshCampText();
    this.deployActed = true;
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint(res.harvested
      ? `${actor.name} disarms the trap and pockets a ${res.harvested}. Reposition or End Turn.`
      : `${actor.name} disarms the trap (storage full — the kit is lost). Reposition or End Turn.`);
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
    this.refreshFocusCard();
    this.refreshPreviewCard();
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
    this.safeZoneGfx.clear();
    this.dangerZoneGfx.clear();
    if (!this.front || !this.campfire) return;
    for (let row = 0; row < this.grid.rows; row++) {
      for (let col = 0; col < this.grid.cols; col++) {
        const t = { col, row };
        if (!this.grid.isWalkable(t)) continue;
        switch (this.zoneOf(t)) {
          case "danger":
            this.fillTileDiamond(this.dangerZoneGfx, t, COLOR.danger, 0.34);
            break;
          case "warning":
            // The ring about to fall next turn — a warning telegraph in amber.
            this.fillTileDiamond(this.dangerZoneGfx, t, COLOR.accent, 0.22);
            break;
          case "neutral":
            // Open ground — unprotected, so a real (if lower) capture risk: a faint
            // danger wash so it never reads as free, safe space (D-feel).
            this.fillTileDiamond(this.dangerZoneGfx, t, COLOR.danger, 0.1);
            break;
          case "safe":
            this.fillTileDiamond(this.safeZoneGfx, t, COLOR.successDeep, 0.28);
            break;
        }
      }
    }
    // Trace a dotted outline around each zone's perimeter for at-a-glance clarity.
    this.strokeZoneOutline(this.safeZoneGfx, "safe", COLOR.success);
    this.strokeZoneOutline(this.dangerZoneGfx, "warning", COLOR.accent);
    this.strokeZoneOutline(this.dangerZoneGfx, "danger", COLOR.danger);
    // The tarpit ring renders in Deployment too (D64) — position around the tax.
    this.refreshAuras();
  }

  /**
   * Which deployment band a walkable tile falls in (drives both fill and outline). The
   * green **safe** core is capture-immune; **neutral** open ground is a real (lower)
   * capture risk — there is no free ground — and the **danger** net is near-guaranteed.
   */
  private zoneOf(t: GridCoord): "danger" | "warning" | "safe" | "neutral" {
    if (inDangerZone(t, this.front)) return "danger";
    if (inSafeZone(t, this.campfire, this.front)) return "safe";
    if (stepDistance(t, this.front.origin) === this.front.radius + 1) return "warning";
    return "neutral";
  }

  /**
   * Stroke a dashed line along every tile edge where a `zone` tile meets a tile
   * of another band — the visible boundary of that zone. Iso diamond edges map to
   * the four orthogonal grid neighbours.
   */
  private strokeZoneOutline(g: Phaser.GameObjects.Graphics, zone: "danger" | "warning" | "safe", color: number): void {
    const halfW = this.view.halfW();
    const halfH = this.view.halfH();
    // Neighbour delta → the two diamond vertices (relative to centre) of the shared edge.
    const edges: Array<{ dc: number; dr: number; a: [number, number]; b: [number, number] }> = [
      { dc: 1, dr: 0, a: [halfW, 0], b: [0, halfH] }, // col+1 → bottom-right edge
      { dc: -1, dr: 0, a: [0, -halfH], b: [-halfW, 0] }, // col-1 → top-left edge
      { dc: 0, dr: 1, a: [0, halfH], b: [-halfW, 0] }, // row+1 → bottom-left edge
      { dc: 0, dr: -1, a: [0, -halfH], b: [halfW, 0] }, // row-1 → top-right edge
    ];
    g.lineStyle(1.5, color, 0.9);
    for (let row = 0; row < this.grid.rows; row++) {
      for (let col = 0; col < this.grid.cols; col++) {
        const t = { col, row };
        if (!this.grid.isWalkable(t) || this.zoneOf(t) !== zone) continue;
        const { x, y } = this.tileToWorld(t);
        for (const e of edges) {
          const n = { col: col + e.dc, row: row + e.dr };
          const outside = !this.grid.isWalkable(n) || this.zoneOf(n) !== zone;
          if (outside) this.dashedLine(g, x + e.a[0], y + e.a[1], x + e.b[0], y + e.b[1]);
        }
      }
    }
  }

  /** Draw a dashed segment from (x1,y1) to (x2,y2) on `g` using the active line style. */
  private dashedLine(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, dash = 5, gap = 4): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const ux = dx / len;
    const uy = dy / len;
    for (let d = 0; d < len; d += dash + gap) {
      const end = Math.min(d + dash, len);
      g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * end, y1 + uy * end);
    }
  }

  /** Mark the two sources on the board: an ember star at the campfire, a red one at the foe. */
  private drawSourceMarkers(): void {
    clearLayer(this.deployMarkers);
    if (!this.campfire || !this.front) return;
    const camp = this.tileToWorld(this.campfire.origin);
    const foe = this.tileToWorld(this.front.origin);
    this.deployMarkers.push(
      this.add.star(camp.x, camp.y, 5, 5, 11, COLOR.accent).setStrokeStyle(2, COLOR.gold).setDepth(0.9),
      this.add.star(foe.x, foe.y, 6, 5, 11, COLOR.danger).setStrokeStyle(2, COLOR.foeEdge).setDepth(0.9),
    );
  }

  /** Fill one iso tile diamond with a colour + alpha — shared by the deploy overlays. */
  private fillTileDiamond(g: Phaser.GameObjects.Graphics, coord: GridCoord, color: number, alpha: number): void {
    const { x, y } = this.tileToWorld(coord);
    const halfW = this.view.halfW();
    const halfH = this.view.halfH();
    g.fillStyle(color, alpha);
    g.beginPath();
    g.moveTo(x, y - halfH);
    g.lineTo(x + halfW, y);
    g.lineTo(x, y + halfH);
    g.lineTo(x - halfW, y);
    g.closePath();
    g.fillPath();
  }

  private deployMove(tile: GridCoord): void {
    const actor = this.deployActor;
    if (!actor || actor.captured || this.busy) return;
    if (this.deployMoved) {
      this.setHint("Already repositioned this turn — Dig In, place a trap, or End Turn (Space).");
      return;
    }
    const nav = occupiedGrid(this.grid, this.battle.units, [actor], actor.side); // route through friendly bodies (D55)
    const path = findPath(nav, actor.pos, tile);
    if (!path || path.length < 2) {
      this.setHint("Can't move there.");
      return;
    }
    // Clamp to the move budget, then back off any trailing tile a friendly body
    // sits on — you can cross an ally but not stop on one (D55).
    const occupied = new Set(this.battle.units.filter((u) => u.alive && u !== actor).map((u) => `${u.pos.col},${u.pos.row}`));
    let steps = path.slice(1).slice(0, moveBudget(actor));
    while (steps.length > 0 && occupied.has(`${steps[steps.length - 1].col},${steps[steps.length - 1].row}`)) steps = steps.slice(0, -1);
    if (steps.length === 0) {
      this.setHint("Can't stop there — an ally holds the only tile in reach.");
      return;
    }
    // Per-step trap read (D12): before each step the unit may sense a hidden enemy
    // trap and balk — or blunder onto one it missed. Truncate the route to what it
    // actually walks; an already-spotted trap simply stops it short of itself.
    const spot = spotWhileMoving(actor, steps, this.battle.entities, this.spotRng);
    const walked = spot.path;
    if (walked.length === 0) {
      // A trap sits on the very next tile (sensed now, or already known) — hold ground.
      if (spot.spotted) this.redrawTrapMarkers();
      this.setHint(
        `${actor.name} ${spot.spotted ? "senses a hidden trap" : "won't step onto the spotted trap"} just ahead ` +
          `(${ICON.trapArmed.glyph}) — route around it, Disarm it, or End Turn.`,
      );
      return;
    }
    const hpBefore = actor.hp;
    // Route the reposition through the one interpreter (D63): it walks the path
    // (logged + undoable), springs any entity crossed, and breaks the dig-in stance.
    this.battle.deployMove(actor, walked);
    this.deployMoved = true;
    this.busy = true;
    this.animateMove(actor, walked, () => {
      this.busy = false;
      this.highlightTile(actor.pos);
      this.refreshAuras(); // a repositioned Heavy Knight drags its tarpit ring (D64)
      this.checkTrapSprings(); // a missed trap just sprang underfoot — reveal + mark it
      if (spot.spotted) this.redrawTrapMarkers(); // a sensed trap — draw its fresh marker
      this.refreshDeployButtons();
      this.refreshDeployStatus();
      this.setHint(
        spot.spotted
          ? `${actor.name} senses a hidden trap just in time (${ICON.trapArmed.glyph}) and stops short — Disarm it, place a trap, or End Turn.`
          : actor.hp < hpBefore
            ? `${ICON.trapSprung.glyph} ${actor.name} stepped on a hidden trap! Dig In, place a trap, or End Turn.`
            : `${actor.name} repositioned. Dig In, place a trap, or End Turn (Space) to advance the net.`,
      );
    });
  }

  /** Drop the capture-net cage on a unit's tile (shared deploy FX). */
  private dropNet(unit: Unit): void {
    const { x, y } = this.tileToWorld(unit.pos);
    this.boardObjects.push(dropNetCage(this, x, y - this.view.halfH()));
  }

  private placeTrap(effect: PlaceTrapEffect): void {
    const actor = this.deployActor;
    if (!actor || actor.captured || this.busy) return;
    // The rules (kit cost, tile clear, entity registration, use-XP) run through the
    // one interpreter now (D63: Battle.placeTrap → the logged, undoable placeTrap
    // action); the scene keeps only the board marker, keyed by entity id.
    const id = `ptrap-${this.trapSeq++}`;
    const res = this.battle.placeTrap(actor, actor.pos, effect, id);
    if (!res.ok) {
      this.setHint(res.reason ?? "Can't place a trap here.");
      return;
    }
    const { x, y } = this.tileToWorld(actor.pos);
    const marker = this.add.text(x, y - this.view.halfH(), ICON.trapMine.glyph, { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(0.8);
    this.boardObjects.push(marker);
    this.playerTrapMarkers.set(id, marker);
    this.refreshCampText();
    this.deployActed = true;
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    this.setHint((res.levels ?? 0) > 0
      ? `Trap placed — ${actor.name} reached L${actor.level}! End Turn (Space) to advance the net.`
      : "Trap placed. End Turn (Space) to advance the net.");
  }

  // --- Phase: Battle ---------------------------------------------------------

  private startBattle(): void {
    this.phase = "battle";
    // The net closes and the foe resolves into view — lift the deployment veil (D12).
    this.view.concealEnemies = false;
    this.titleText.setText("Battle");
    this.refreshIntelText(); // re-style the roster line down to passive reference (D-UX)
    this.legendStrip.setItems(BATTLE_LEGEND);
    this.clearActionButtons();
    this.theftAttempts.clear();
    this.goldStolen = 0;
    this.goldRecovered = 0;
    this.pendingRecruits = [];
    this.bribeArmed = false;
    this.deployActor = null;
    this.safeZoneGfx?.clear();
    this.dangerZoneGfx?.clear();
    clearLayer(this.deployMarkers);
    this.highlightTile(null);

    // Player traps were registered as entities at placement; the entity announces
    // its own spring (the trapSprung bus event), so the scene just animates the marker.
    this.battle.bus.on("trapSprung", ({ id }) => {
      const m = this.playerTrapMarkers.get(id);
      if (!m) return;
      m.setText(ICON.trapSprung.glyph).setColor(INK.disabled);
      this.tweens.add({ targets: m, scale: 1.8, duration: 140, yoyo: true });
    });
    // Floating combat text + impact scaling ride the rules' damage/heal bus, so
    // they cover every source (attacks, traps, charged skills) — parity with the demo.
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
    this.battle.bus.on("turnStart", ({ unit }) => this.view.logTurn(unit));

    // Snapshot primary-job levels so resolution can read out who leveled up (D53).
    this.preBattleJobLevels = new Map(this.battle.units.filter((u) => u.side === "player").map((u) => [u.id, jobLevelOf(u, u.primaryJob)]));

    // beginBattle: Chef heal + morale-warmed initiative seed (D8).
    const healed = this.loop.beginBattle();
    this.refreshCampText();
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
    const trapHint = hiddenTraps(this.battle.entities).length > 0 || this.trapMarkers.size > 0
      ? `Traps are seeded ahead — watch for ${ICON.trapArmed.glyph}, and let a trapper disarm them. `
      : "";
    this.setHint((healed > 0 ? `Chef's stew restored ${healed} HP. ` : "Battle begins. ") + trapHint + (bound ? `${bound.name} is bound — rescue or win to free her. ` : "") + "Press Advance Clock.");
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
    this.armedAim = null;
    this.recomputeReach(actor);
    // The active unit looks around — an Awareness roll may spot nearby traps (D12).
    this.spotTrapsForActor(actor);
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
  }

  private showSkillButtons(actor: Unit): void {
    const specs: { text: string; description?: string; onClick: () => void }[] = [];
    // Undo leads whenever this turn's actions can be taken back — anything done this
    // turn (a move *or* a strike/skill), as long as no sprung trap has locked it (no
    // take-back on damage taken, D60). Routes through the action log (Phase 2).
    if (this.battle.canUndo() && !this.turnLocked) {
      specs.push({ text: "Undo Turn", description: "Take back everything this unit did this turn — moves and strikes — back to where it started (Esc).", onClick: () => this.undoTurn(actor) });
    }
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
      // Trap-field verbs (D12): Search to scan for hidden traps; the trapper disarms
      // a spotted, adjacent one to pocket its kit. Only surfaced when traps are afield.
      if (hiddenTraps(this.battle.entities).length > 0) {
        specs.push({
          text: "Search",
          description: "Spend this unit's action scanning the ground ahead for concealed traps (a wider, better look).",
          onClick: () => this.doSearch(actor),
        });
      }
      const adjTrap = this.adjacentRevealedTrap(actor);
      if (adjTrap && canDisarm(actor)) {
        specs.push({
          text: "Disarm trap",
          description: "Disarm the adjacent spotted trap and pocket its kit (a trap-trained unit only).",
          onClick: () => this.doDisarm(actor, adjTrap.id),
        });
      }
      // The universal Defend (D41): every unit can brace until its next turn — the
      // always-available defensive verb, even for a unit with no job actives.
      // The universal Defend (D41) keeps its dedicated "D" key, sourced from the same
      // availableSkills projection (D67) — no separate hardcoded append.
      const defend = availableSkills(actor, "combat").find((s) => s.id === DEFEND.id);
      if (defend) specs.push({ text: "Defend (D)", description: `${defend.description}  ·  key D.`, onClick: () => this.onSkillButton(actor, defend) });
    }
    // The turn's explicit close is the prominent green primary button (plus Space and
    // W) — so the action row carries only the unit's *verbs*, not a second End Turn.
    this.layoutActionMenu(specs);
  }

  // --- Trap-field: spotting, searching, disarming (D12) ----------------------

  /** Roll the active unit's Awareness against nearby hidden traps; draw any spotted. */
  private spotTrapsForActor(actor: Unit, search = false): void {
    if (hiddenTraps(this.battle.entities).length === 0) return;
    const found = revealTrapsNear(actor, this.battle.entities, this.spotRng, { search });
    if (found.length > 0) {
      this.redrawTrapMarkers();
      this.setHint(`${actor.name} spots ${found.length} hidden trap${found.length > 1 ? "s" : ""}! (${ICON.trapArmed.glyph})`);
    }
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

  /** Spend this unit's Act on a deliberate Search — a wider radius and a better spot roll. */
  private doSearch(actor: Unit): void {
    if (this.busy || this.waitingFor !== actor || this.acted) return;
    this.spotTrapsForActor(actor, true);
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.armedAim = null;
    this.noteAct();
    this.afterActionContinue(actor);
  }

  /** Disarm a spotted adjacent trap (Survivalist), harvest its kit — the unit's Act. */
  private doDisarm(actor: Unit, trapId: string): void {
    if (this.busy || this.waitingFor !== actor || this.acted) return;
    const res = disarmTrap(this.battle.entities, trapId, actor, this.run.inventory);
    if (!res.ok) return this.setHint(`Can't disarm: ${res.reason}`);
    this.redrawTrapMarkers();
    this.refreshCampText();
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.armedAim = null;
    this.noteAct();
    this.afterActionContinue(actor);
    this.setHint(res.harvested
      ? `${actor.name} disarms the trap and pockets a ${res.harvested}.`
      : `${actor.name} disarms the trap (storage full — the kit is lost).`);
  }

  /**
   * Sync the board markers to the concealed traps: a {@link ICON.trapArmed} on each
   * revealed armed trap, a faded {@link ICON.trapSprung} once sprung, and nothing for
   * disarmed (removed) ones.
   */
  private redrawTrapMarkers(): void {
    const traps = this.battle.entities.all().filter(isConcealedTrap);
    for (const t of traps) {
      if (!t.revealed) continue;
      let m = this.trapMarkers.get(t.id);
      if (!m) {
        const { x, y } = this.tileToWorld(t.pos);
        // Glyphs come from the icon registry (D59) — all verified to render in the UI font.
        m = this.add.text(x, y - this.view.halfH(), ICON.trapArmed.glyph, { color: "#e06b6b", fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(0.85);
        this.boardObjects.push(m);
        this.trapMarkers.set(t.id, m);
      }
      m.setText(t.sprung ? ICON.trapSprung.glyph : ICON.trapArmed.glyph).setColor(t.sprung ? INK.disabled : "#e06b6b");
    }
    // Drop markers for disarmed traps (no longer registered).
    for (const [id, m] of this.trapMarkers) {
      if (!traps.some((t) => t.id === id)) {
        m.destroy();
        this.trapMarkers.delete(id);
      }
    }
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
    if (this.trapMarkers.size > 0 || sprang) this.redrawTrapMarkers();
    if (sprang) this.setHint(`${ICON.trapSprung.glyph} A hidden trap sprang!`);
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
    // On success, flip the enemy to the player's side for the rest of the fight. A failed
    // sway (res.failed) still spent the Influence and the Act — the moment passed.
    if (res.applied) {
      (foe as unknown as { side: Side }).side = "player";
      const view = this.view.views.get(foe.id);
      view?.body.setFillStyle(COLOR.ally).setStrokeStyle(2, COLOR.allyEdge);
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
    // Makes the medic work in **every** fight, not just the demo.
    if (skill.effect.kind === "med-heal") {
      const herbs = ["salve", "stimulant", "antidote"].filter((h) => countOf(this.run.inventory, h) > 0);
      if (herbs.length === 0) return this.setHint("No herbs carried — provision some at camp.");
      this.layoutActionMenu(
        herbs.map((h) => ({
          text: `${h} (${countOf(this.run.inventory, h)})`,
          description: `Heal with ${h}.`,
          onClick: () => {
            this.pendingHerb = h;
            this.armedSkill = skill;
            this.armedAim = null;
            this.setHint(`Heal (${h}): click a wounded ally (or click ${actor.name} to cancel).`);
            this.drawPreview();
          },
        })),
      );
      return;
    }
    if (skill.target === "self") return this.commitSkill(actor, skill, actor);
    this.armedSkill = skill;
    this.armedAim = null;
    this.setHint(`${skill.name}: click a valid target (or click ${actor.name} to cancel).`);
    this.drawPreview();
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
    // The skill is the unit's Act; its CT cost follows the skill's spend (D60).
    this.noteAct(skill.spend === "act");
    this.refreshHud();
    this.afterActionContinue(actor);
    if (!this.over && this.waitingFor === actor) {
      this.setHint(`${actor.name} used ${skill.name} — ${verb}. ${this.canMoveFurther() ? "Move on, or " : ""}End Turn (Space/W).`);
    }
  }

  private runEnemyTurn(actor: Unit): void {
    this.busy = true;
    this.setHint(`${actor.name} (enemy) acts…`);
    // The thief archetype (D30): on its first turn it skims the run PURSE, then
    // bolts for the edge. Kill it before it escapes to recover the gold.
    if (actor.thief && actor.alive && !this.theftAttempts.has(actor.id)) {
      const attempt = thiefSteal(this.run, `thief:${actor.id}`);
      if (attempt.stolen > 0) {
        this.theftAttempts.set(actor.id, attempt);
        this.goldStolen += attempt.stolen;
        this.refreshCampText();
        this.setHint(`${actor.name} lifted ${attempt.stolen}g off the purse! Cut it down before it escapes to recover the gold.`);
      }
    }
    const plan = this.battle.runEnemyTurn(actor);
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
        this.refreshCampText();
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
      if (this.phase === "battle" && !this.turnLocked && this.waitingFor && !this.busy && this.battle.canUndo()) return this.undoTurn(this.waitingFor);
      // Deploy turn take-back (D63) — the deploy twin of the combat undo.
      if (this.phase === "deployment" && this.deployActor && !this.busy && this.battle.canUndo()) return this.undoDeployTurn(this.deployActor);
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
    const cx = this.scale.width / 2;
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
    this.legend.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.96).setStrokeStyle(2, COLOR.btnStroke).setDepth(30),
      this.add.text(cx, cy - h / 2 + 20, "Legend & Keys  (L to close)", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0.5).setDepth(31),
      this.add.text(cx - w / 2 + 22, cy - h / 2 + 44, body, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.caption, lineSpacing: 3 }).setOrigin(0, 0).setDepth(31),
    );
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const tile = this.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid || !this.grid.inBounds(tile)) return;

    if (this.phase === "deployment") {
      // Turn-based deployment (D63): only the unit whose turn it is may act. An armed deploy
      // ability commits on a valid target — the same arm→click flow as combat, through the
      // drained deploySkill verb (D67); otherwise clicking an empty tile repositions it.
      if (this.busy || !this.deployActor) return;
      const actor = this.deployActor;
      const clicked = this.battle.units.find((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row);
      if (this.armedSkill) {
        if (clicked === actor) {
          this.armedSkill = null;
          this.refreshDeployButtons();
          this.setHint(`${actor.name}'s turn — reposition, use an ability, or End Turn (Space).`);
          return;
        }
        if (clicked && isValidSkillTarget(this.armedSkill, actor, clicked)) this.castDeploySkill(actor, this.armedSkill, clicked);
        else this.setHint("Not a valid target for that skill.");
        return;
      }
      if (!clicked) this.deployMove(tile);
      return;
    }
    if (this.phase !== "battle") return;

    const actor = this.waitingFor;
    if (this.over || this.busy || !actor) return;
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

    if (clicked && clicked.captured && clicked.side === actor.side && clicked !== actor) this.playerRescue(actor, clicked);
    else if (clicked && clicked.side !== actor.side && !clicked.captured) this.playerAttack(actor, clicked);
    else if (clicked === actor) this.setHint(this.turnHint(actor)); // clicking yourself is a no-op nudge
    else if (!clicked && this.grid.isWalkable(tile)) this.playerMoveStep(actor, tile);
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
    freeCaptive(captive);
    this.tintCaptured(captive, false);
    this.noteAct();
    this.flashHeal(captive);
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
   * Step the unit to a clicked **lit** tile, spending that leg of its move budget
   * (D60). Only tiles in `reach` (the remaining budget) are walkable — a click
   * outside it just hints. The move fires its side-effects (traps, auras); if a
   * trap bites (HP drops) the turn *locks* — no take-back on damage taken. The turn
   * stays open so the unit can strike, move again, or End Turn.
   */
  private playerMoveStep(actor: Unit, tile: GridCoord): void {
    const r = this.reachByKey.get(`${tile.col},${tile.row}`);
    if (!r || r.path.length === 0) {
      return this.setHint(
        this.canMoveFurther()
          ? "Out of reach — click a lit tile (you move in steps, not leaps)."
          : `${actor.name} is out of moves — strike a foe, use a skill, or End Turn (Space/W).`,
      );
    }
    // Per-step trap read (D12): the unit may sense a hidden enemy trap and stop short,
    // or blunder onto one it missed. Truncate the click's route to what it actually
    // walks; a trap it already spotted halts it short (you don't step onto one you see).
    const spot = spotWhileMoving(actor, r.path, this.battle.entities, this.spotRng);
    const walked = spot.path;
    if (walked.length === 0) {
      if (spot.spotted) this.redrawTrapMarkers();
      return this.setHint(
        `${actor.name} ${spot.spotted ? "senses a hidden trap" : "won't step onto the spotted trap"} ` +
          `(${ICON.trapArmed.glyph}) — route around it, Disarm it, strike, or End Turn.`,
      );
    }
    // The walked route ends on a tile from the original reach, so its weighted cost is
    // exactly the reach cost to that halt tile (a tarpit ring costs extra to enter, D42).
    const halt = walked[walked.length - 1];
    const cost = this.reachByKey.get(`${halt.col},${halt.row}`)?.cost ?? r.cost;
    const hpBefore = actor.hp;
    this.busy = true;
    this.armedSkill = null;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.armedAim = null;
    this.battle.moveUnit(actor, walked);
    this.movedThisTurn = true;
    this.moveBudget -= cost;
    this.animateMove(actor, walked, () => {
      this.checkTrapSprings();
      if (spot.spotted) this.redrawTrapMarkers(); // a sensed trap — draw its fresh marker
      this.refreshHud();
      if (!actor.alive || this.encounterDecided()) {
        this.busy = false;
        return this.afterTurn();
      }
      if (actor.hp < hpBefore) this.turnLocked = true; // a trap bit — the move stands
      this.afterActionContinue(actor);
      // Override the generic turn hint when the unit balked at a freshly-sensed trap.
      if (spot.spotted && this.waitingFor === actor && !this.over) {
        this.setHint(`${actor.name} senses a hidden trap (${ICON.trapArmed.glyph}) and stops short — Disarm it, strike, or End Turn.`);
      }
    });
  }

  /**
   * Undo **this unit's whole turn** (D60 / *Into the Breach* take-back): roll the
   * battle back to where the turn began through the action log — including a strike
   * or skill, not just movement — then resync the board. The clock, in-flight
   * charges, statuses, revived foes and the RNG cursor all revert in core
   * ({@link "../../core/turn".Battle.undoAll}); the render just re-reads the result.
   * Forbidden once a sprung trap has locked the turn (no take-back on damage taken)
   * or while an animation is mid-flight.
   */
  private undoTurn(actor: Unit): void {
    if (this.busy || this.turnLocked || this.waitingFor !== actor || !this.battle.canUndo()) return;
    this.armedSkill = null;
    this.pendingHerb = null;
    this.bribeArmed = false;
    this.battle.undoAll(); // core: positions, HP, statuses, clock/charges, RNG cursor, log
    // Render flags back to the turn's start.
    this.moveBudget = moveBudget(actor);
    this.acted = false;
    this.actCharged = false;
    this.movedThisTurn = false;
    // Resync every unit's view — the take-back may have moved/revived/healed others.
    for (const u of this.battle.units) {
      this.placeView(u);
      if (u.side === "player") this.tintCaptured(u, u.captured);
    }
    refreshAuras(this.battle.units); // confirm the tarpit ring matches the restored positions (D40)
    this.recomputeReach(actor);
    this.highlightTile(actor.pos);
    this.refreshHud();
    this.showSkillButtons(actor);
    this.drawPreview();
    this.setHint(`${actor.name}'s turn reset — take it again, or End Turn (Space/W).`);
  }

  private afterTurn(): void {
    this.busy = false;
    this.movedThisTurn = false;
    this.acted = false;
    this.actCharged = false;
    this.turnLocked = false;
    this.hoverTile = null;
    this.hoverFoe = null;
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
    this.highlightTile(null);
    this.clearActionButtons();

    const goldEscaped = this.tallyEscapedThieves();
    const res = this.loop.resolve();
    const recruited = this.commitPendingRecruits();

    this.refreshCampText();
    this.refreshHp();
    this.refreshObjectiveText();
    // Re-tint any freed allies.
    for (const u of this.run.party) if (!u.captured) this.tintCaptured(u, false);

    const report = this.buildResolutionSummary(res, goldEscaped, recruited);
    this.showResolutionReport(report);
    this.setHint(`Resolution — ${report.title}. ${report.subtitle}`);
    // On any terminal (wipe / loss / run-complete) the overworld shows the end
    // screen; otherwise the player returns to the map to pick the next node.
    this.setPrimary(res.over ? (this.loop.isComplete() ? "See Results" : "Run Over") : "Return to Map");
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

  /**
   * Build the three-way graded terminal (D50/D51) — win / objective-failure / wipe —
   * as a structured **after-action report**: a titled, toned headline and grouped,
   * icon-led sections (Spoils, The party, Advancement, Aftermath). Pure assembly off
   * the resolved result; empty sections are dropped by the renderer. The grouping
   * follows the D-UX rule — the payoff (spoils, level-ups) and the costs (casualties,
   * captures) read as distinct, colour-coded blocks instead of one grey wall.
   */
  private buildResolutionSummary(
    res: ResolveResult,
    goldEscaped: number,
    recruited: string[],
  ): ResolutionReport {
    const won = res.result === "win";
    const title = won ? "Victory!" : res.result === "objective-failure" ? "Objective Failed — Retreat" : "Defeat";
    const subtitle = won
      ? "The field is won — gather the spoils and move on."
      : res.result === "objective-failure"
        ? "The objective was lost — the party retreats alive, the prize forfeited."
        : "The party was overwhelmed.";
    const nameOf = (id: string) => this.battle.units.find((u) => u.id === id)?.name ?? id;

    const spoils: ReportRow[] = [];
    if (won) {
      spoils.push({ icon: "spoils", text: `+${res.goldEarned} gold`, color: INK.gold });
      spoils.push(
        res.recovered.length
          ? { icon: "loot", text: `Recovered ${res.recovered.length} unsprung trap kit${res.recovered.length === 1 ? "" : "s"}` }
          : { text: "No unsprung materials to recover.", color: INK.muted },
      );
    }

    // The party (D51): rescues and casualties apply on either survivable outcome.
    const party: ReportRow[] = [];
    if (res.rescued.length) party.push({ icon: "rescued", text: `Freed by winning the field: ${res.rescued.join(", ")}`, color: INK.success });
    if (res.result !== "wipe") {
      if (res.downed.length) party.push({ icon: "fallen", text: `Downed: ${res.downed.map((d) => `${nameOf(d.unitId)} (${d.resolution})`).join(", ")}`, color: INK.ember });
      if (res.permadeaths.length) party.push({ icon: "lost", text: `Lost forever: ${res.permadeaths.map(nameOf).join(", ")}`, color: INK.danger });
    }
    // Captives left behind become rescue follow-ups (D9/D21) — name them so the
    // abandonment isn't silently dropped; the Captain's Journal keeps nagging after.
    if (res.rescueQuests.length) party.push({ icon: "captive", text: `Captured — needs rescue: ${res.rescueQuests.map((q) => nameOf(q.unitId)).join(", ")}`, color: INK.ember });

    // Advancement (D53): who reached a new job level, with their new actives.
    const advancement: ReportRow[] = [];
    for (const u of this.battle.units) {
      if (u.side !== "player") continue;
      const was = this.preBattleJobLevels.get(u.id) ?? jobLevelOf(u, u.primaryJob);
      const now = jobLevelOf(u, u.primaryJob);
      if (now > was) {
        const actives = unlockedSkills(u, "battle").map((s) => s.name).join(", ");
        advancement.push({ icon: "levelUp", text: `${u.name} reached job L${now}${actives ? ` — ${actives}` : ""}`, color: INK.gold });
      }
    }

    // Aftermath (M10): theft, recruitment, and the run-complete flourish.
    const aftermath: ReportRow[] = [];
    if (this.goldStolen > 0) aftermath.push({ icon: "theft", text: `Thieves skimmed ${this.goldStolen}g — recovered ${this.goldRecovered}g${goldEscaped > 0 ? `, ${goldEscaped}g escaped` : ""}`, color: INK.ember });
    if (recruited.length) aftermath.push({ icon: "recruited", text: `Swayed to the guild (permanent): ${recruited.join(", ")}`, color: INK.cyan });
    if (won && this.loop.isComplete()) aftermath.push({ icon: "levelUp", text: "The final mission is cleared — the run is complete!", color: INK.gold });

    const sections: ReportSection[] = [
      { heading: "Spoils", rows: spoils },
      { heading: "The party", rows: party },
      { heading: "Advancement", rows: advancement },
      { heading: "Aftermath", rows: aftermath },
    ];
    return { title, good: won, subtitle, sections };
  }

  /** Hand the run back to the overworld so the player can pick the next node. */
  private returnToOverworld(): void {
    this.scene.start("OverworldScene", { run: this.run, loop: this.loop, guild: this.guild, caravanId: this.caravanId } as RunHandoff);
  }

  /**
   * Render the {@link ResolutionReport} as a centred after-action card: a toned
   * headline + subtitle over icon-led, colour-coded sections. Self-sizes to its
   * content (empty sections skipped, long rows wrap) and is built in a Container so a
   * single clearLayer tears the whole report down on Return to Map.
   */
  private showResolutionReport(r: ResolutionReport): void {
    clearLayer(this.overlay);
    const w = 484;
    const padX = 26;
    const leftX = -w / 2 + padX;
    const accent = r.good ? COLOR.success : COLOR.danger;
    const card = this.add.container(this.scale.width / 2, 0).setDepth(20);

    let y = 22;
    card.add(this.add.text(0, y, r.title, { color: r.good ? INK.success : INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5, 0));
    y += 36;
    const sub = this.add.text(0, y, r.subtitle, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body, align: "center", wordWrap: { width: w - 2 * padX } }).setOrigin(0.5, 0);
    card.add(sub);
    y += sub.height + 12;

    for (const sec of r.sections) {
      if (sec.rows.length === 0) continue;
      card.add(this.add.text(leftX, y, sec.heading.toUpperCase(), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0));
      card.add(this.add.rectangle(leftX, y + 15, w - 2 * padX, 1, COLOR.borderSoft).setOrigin(0, 0.5));
      y += 22;
      for (const row of sec.rows) {
        const spec: IconSpec | undefined = row.icon ? ICON[row.icon] : undefined;
        const glyph = this.add.text(leftX, y, spec?.glyph ?? "·", { color: spec?.color ?? INK.muted, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0);
        const text = this.add.text(leftX + 20, y, row.text, { color: row.color ?? INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, wordWrap: { width: w - 2 * padX - 20 } }).setOrigin(0, 0);
        card.add([glyph, text]);
        y += Math.max(text.height, 17) + 4;
      }
      y += 10;
    }

    const totalH = y + 6;
    const bg = this.add.rectangle(0, totalH / 2, w, totalH, COLOR.bg, 0.96).setStrokeStyle(2, accent);
    card.addAt(bg, 0);
    card.setY(Math.max(8, this.scale.height / 2 - totalH / 2));
    this.overlay.push(card);
  }

  // --- Drawing helpers -------------------------------------------------------

  private tileToWorld(coord: GridCoord): { x: number; y: number } {
    return this.view.tileToWorld(coord);
  }

  private worldToTile(px: number, py: number): GridCoord {
    return this.view.worldToTile(px, py);
  }

  private drawGrid(): void {
    const g = this.add.graphics();
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

  private refreshHp(): void {
    this.view.refreshUnits();
  }

  private refreshHud(): void {
    // The shared visual initiative rail (CombatView): chips sorted by charge time,
    // the acting unit lit, each carrying side/role, HP and the CT readout. Docked
    // right (the timing/history column) so the left can host the focus card.
    this.orderText.setText("Turn order");
    const limit = this.railExpanded ? undefined : BattleScene.RAIL_COLLAPSED;
    const rail = this.view.drawInitiative(this.battle.units, this.scale.width - 158, 138, (u) => this.battle.clock.isCharging(u), limit);
    this.layoutRailChevron(rail);
    this.refreshHp();
    this.refreshObjectiveText();
    this.refreshFocusCard();
  }

  /**
   * Place the rail's expand/collapse chevron just below the last shown chip. Shown
   * only when the rail actually overflows the collapsed cap (or is expanded past it);
   * clicking toggles {@link railExpanded} and redraws. The chevron lives off-board on
   * the right, so the scene's board click-router no-ops on it.
   */
  private layoutRailChevron(rail: { total: number; shown: number; bottomY: number }): void {
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
    const label = this.railExpanded ? "▴  less" : `▾  ${hidden} more`;
    this.railChevron.setText(label).setPosition(this.scale.width - 158, rail.bottomY + 3).setVisible(true);
  }

  /**
   * The objective banner (D50) — generic over the staged objectives, so any
   * board/objective feature shows up in *every* fight that has it (the scene never
   * names a specific kind). For each non-trivial objective it shows the authored
   * label and, for a timed one, its gauge fill; the default elimination goal is
   * left implicit (the field readout already conveys it).
   */
  private refreshObjectiveText(): void {
    const objs = this.loop.staged?.objectives ?? [];
    const parts: string[] = [];
    for (const o of objs) {
      if (o.spec.kind === "eliminate-all") continue; // implicit — clear the field
      const status = o.status();
      const prog = o.progress();
      if (status === "failed") parts.push(`✗ ${o.spec.label} — failed`);
      else if (status === "met") parts.push(`${ICON.check.glyph} ${o.spec.label} — secured`);
      else if (prog !== undefined) parts.push(`${ICON.warn.glyph} ${o.spec.label} — ${Math.round(prog * 100)}%`);
      else parts.push(`• ${o.spec.label}`);
    }
    this.objectiveText.setText(parts.join("    "));
    this.layoutSituationLine();
  }

  /**
   * Lay the **secondary situation line** (D-UX merge): the objective readout and the
   * intel recap share one centred row at y=42 instead of stacking. The objective —
   * the actionable goal — leads (left); the passive intel recap trails. With only one
   * present the surviving piece simply centres; this keeps the top band two lines
   * (heading + situation) however many of the pieces are live.
   */
  private layoutSituationLine(): void {
    const cx = this.scale.width / 2;
    const y = 42;
    const obj = this.objectiveText;
    const intel = this.intelText;
    const hasObj = obj.text.length > 0;
    const hasIntel = intel.text.length > 0;
    const gap = 18; // the " · " of breathing room between goal and recap
    if (hasObj && hasIntel) {
      const left = cx - (obj.width + gap + intel.width) / 2;
      obj.setOrigin(0, 0.5).setPosition(left, y);
      intel.setOrigin(0, 0.5).setPosition(left + obj.width + gap, y);
    } else if (hasObj) {
      obj.setOrigin(0.5, 0.5).setPosition(cx, y);
    } else {
      intel.setOrigin(0.5, 0.5).setPosition(cx, y);
    }
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
    if (revealed) this.refreshHp(); // refreshUnits re-reads hidden → un-fades the token
  }

  /**
   * The peripheral **camp-state** card (top-right): passive reference you can't
   * change mid-mission (morale, purse, storage), grouped out of the decision zone.
   * Figures owned by core (`campReadout`); the camp-time levers it omits (RP/Upkeep)
   * live on the overworld camp where they're actually spent.
   */
  private refreshCampText(): void {
    const r = campReadout(this.run);
    // Attribute morale to its *effect* here (D-UX): in Deployment high morale trims the
    // capture risk on open (neutral) ground, so the otherwise-inert tier reads as
    // "High (−20% open risk)" — its mechanical pull legible where it lands, not a bare stat.
    const em = this.phase === "deployment" ? this.moraleMods().exposureMultiplier : 1;
    const morale = em < 1 ? `${r.moraleTier} (−${Math.round((1 - em) * 100)}% open risk)` : r.moraleTier;
    this.campCard.set(`Camp · Night ${this.run.night + 1}`, [
      { label: "Morale", value: morale },
      { label: "Purse", value: `${r.purse}g` },
      { label: "Storage", value: `${r.storageUsed}/${r.storageCap}` },
    ]);
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
      if (!actor.captured && protectedHere) {
        rows.push({ label: "Capture risk", value: "safe in camp", color: INK.success });
      } else if (!actor.captured && this.front && this.campfire) {
        // Hot decision: forecast each choice's capture risk (D48 route-forecast ethos),
        // so the card answers "what should this unit do *now*", not just "how bad is it".
        // Repositioning is only on the table before the unit has moved this turn.
        const reach = this.deployMoved ? [] : reachableTiles(actor, this.battle.units, this.grid, moveBudget(actor)).map((r) => r.tile);
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

  private refreshIntelText(): void {
    const r = this.intel;
    if (!r) {
      this.intelText.setText("");
      return;
    }
    // Intel drives the *deployment* decision — where to stand against the scouted
    // roster — so it leads there: gold and prominent. Once the fight is joined the
    // foes are on the board and there's no re-scouting; it becomes passive reference,
    // so in Battle it recedes (muted, caption-sized) and sheds the deploy-only tier /
    // vision / encounter-shape, keeping just the roster as a quiet recap (D-UX rule:
    // prominence follows whether you can act on the info in this phase).
    const battle = this.phase === "battle";
    const parts: string[] = [];
    if (!battle) parts.push(`Intel T${r.tier}`);
    if (r.count !== undefined) parts.push(`${r.count} foe${r.count === 1 ? "" : "s"}`);
    if (r.types && r.types.length) parts.push(compactFoeTypes(r.types));
    if (!battle && r.grantsVision) parts.push("vision");
    // Show the *tactical* encounter shape (open-field vs. fortified = pre-placed
    // hazards, D12) only in Deployment, where it informs placement; an authored
    // set-piece reveals no such banner, so we drop the parenthetical rather than leak
    // the "authored" dev tag.
    const def = currentEncounter(this.run);
    const shape = !battle && !isAuthoredEncounter(def) ? def.type : undefined;
    this.intelText
      .setText(parts.join("  ·  ") + (shape ? `   (${shape})` : ""))
      .setColor(battle ? INK.muted : INK.gold)
      .setFontSize(battle ? FONT.caption : FONT.label);
    this.layoutSituationLine();
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
      this.previewCard.hide();
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
   * The docked **preview card** — "what happens if I commit?" — keyed to the current
   * hover/selection. In Battle: an armed ability's forecast (D64); else the hovered
   * enemy's deal / hits-back; else the hovered move tile's cost + tiles-left. In
   * Deployment: the hovered tile's capture risk. Hidden when there's nothing to
   * preview. Re-docked just under the focus card each call (so it never overlaps a tall
   * card) and recomputed live (HP/stacks/position change as the turn unfolds).
   */
  private refreshPreviewCard(): void {
    if (this.phase === "battle") {
      const actor = this.waitingFor;
      if (!actor || this.busy || this.over) return void this.previewCard.hide();
      if (this.armedSkill) return this.showAbilityForecast(actor);
      if (this.hoverFoe && this.hoverFoe.alive && !this.hoverFoe.hidden) return this.showAttackPreview(actor, this.hoverFoe);
      if (this.hoverTile) return this.showMovePreview(this.hoverTile);
      return void this.previewCard.hide();
    }
    if (this.phase === "deployment") {
      const actor = this.deployActor;
      if (!actor || this.busy || actor.captured || this.armedSkill || !this.deployHoverTile) return void this.previewCard.hide();
      return this.showDeployPreview(actor, this.deployHoverTile);
    }
    this.previewCard.hide();
  }

  /** Show the preview card with `title`/`rows`, docked just beneath the focus card. */
  private showPreview(title: string, rows: CardRow[], alpha = 1): void {
    this.previewCard.set(title, rows).setPosition(8, this.focusCard.bottomY() + 6).setAlpha(alpha);
  }

  /**
   * The armed-ability forecast (D64): build the {@link AbilityForecast} from live state
   * and render it; an out-of-range aim still telegraphs but dims the box.
   */
  private showAbilityForecast(actor: Unit): void {
    const skill = this.armedSkill;
    if (!skill) return void this.previewCard.hide();
    const target = this.armedAim
      ? this.battle.units.find((u) => u.alive && u.pos.col === this.armedAim!.col && u.pos.row === this.armedAim!.row)
      : undefined;
    const fc = forecastSkill(skill, actor, { target, units: this.battle.units, inventory: this.run.inventory, morale: this.run.camp.morale });
    const inRange = !this.armedAim || aimInRange(skill, actor, this.armedAim);
    this.showPreview(skill.name, this.forecastRows(fc), inRange ? 1 : 0.4);
  }

  /** Battle hover — a foe: the strike's expected damage, the hit-back next turn, and whether it's in reach. */
  private showAttackPreview(actor: Unit, foe: Unit): void {
    this.showPreview(foe.name, this.attackPreviewRows(actor, foe), inAttackRange(actor, foe) ? 1 : 0.6);
  }

  /**
   * The deal / hits-back / range rows for hovering `foe` (D-feel). "Deal" is the strike
   * (flank-aware); "Hits back" is the foe's expected retaliation **on its next turn** —
   * there's no auto-counter today, but the row is the seam for a future retaliate effect.
   */
  private attackPreviewRows(actor: Unit, foe: Unit): CardRow[] {
    const units = this.battle.units;
    const deal = computeDamage(actor, foe, actor.attack, units);
    const back = computeDamage(foe, actor, foe.attack, units);
    const reach = inAttackRange(actor, foe);
    const skull = (n: number, t: Unit) => (n >= t.hp ? ` ${ICON.lethal.glyph}` : "");
    return [
      { label: "Deal", value: `${deal}${skull(deal, foe)}`, color: deal >= foe.hp ? INK.ember : INK.danger, emphasize: true },
      { label: "Hits back", value: `${back}${skull(back, actor)}`, color: back >= actor.hp ? INK.danger : INK.muted },
      { label: "Range", value: reach ? "in reach" : "move adjacent", color: reach ? INK.success : INK.muted },
    ];
  }

  /** Battle hover — a reachable tile: this step's cost, the budget left after it, and whether the Act is still up. */
  private showMovePreview(tile: GridCoord): void {
    const r = this.reachByKey.get(`${tile.col},${tile.row}`);
    if (!r || r.path.length === 0) return void this.previewCard.hide();
    const left = Math.max(0, this.moveBudget - r.cost);
    this.showPreview("Move here", [
      { label: "Move cost", value: `${r.cost}`, color: INK.secondary },
      { label: "Tiles left", value: `${left}`, color: left > 0 ? INK.success : INK.muted, emphasize: true },
      // Reinforce that one Act can still fall before/after the move (the D60 free-move turn).
      { label: "Action", value: this.acted ? "spent" : "ready", color: this.acted ? INK.muted : INK.success },
    ]);
  }

  /** Deployment hover — a walkable tile: its capture risk for the active unit, plus the band it sits in. */
  private showDeployPreview(actor: Unit, tile: GridCoord): void {
    const protectedHere = isProtected(tile, this.campfire);
    const inNet = inDangerZone(tile, this.front);
    const risk = captureChanceAt(tile, this.campfire, this.front, {
      evasion: captureEvasionFactor(actor),
      exposureMultiplier: this.deployMods().exposureMultiplier,
    });
    const band = protectedHere ? "Safe core" : inNet ? "In the net" : "Open ground";
    this.showPreview("If moved here", [
      { label: "Capture risk", value: protectedHere ? "none" : `${Math.round(risk * 100)}%`, color: protectedHere ? INK.success : inNet ? INK.danger : INK.ember, emphasize: true },
      { label: "Zone", value: band, color: protectedHere ? INK.success : inNet ? INK.danger : INK.muted },
    ]);
  }

  /** Map a tagged {@link AbilityForecast} to the forecast box's label→value rows (D64). */
  private forecastRows(fc: AbilityForecast): CardRow[] {
    const glyphs = (g?: { lethal?: boolean }) => (g?.lethal ? ` ${ICON.lethal.glyph}` : "");
    switch (fc.kind) {
      case "immediate":
      case "computed":
        return [{ label: fc.label, value: `${fc.value}${glyphs(fc.glyphs)}`, color: fc.glyphs?.lethal ? INK.ember : INK.secondary, emphasize: true }];
      case "conditional":
        // "Damage 12 (vs debuffed +4)" / "Trap — if a foe enters: 12".
        return fc.value > 0
          ? [
              { label: fc.label, value: `${fc.value}${glyphs(fc.glyphs)}`, emphasize: true },
              { label: fc.condition, value: `+${fc.bonus}`, color: INK.gold },
            ]
          : [{ label: fc.label, value: `${fc.condition}: ${fc.bonus}`, color: INK.ember }];
      case "deferred": {
        // "Mark Prey — 0 now → +2/hit (cap +8)".
        const parts: string[] = [`${fc.now} now`];
        if (fc.perHit !== undefined) parts.push(`+${fc.perHit}/hit`);
        if (fc.cap !== undefined) parts.push(`(cap +${fc.cap})`);
        if (fc.etaTurns !== undefined) parts.push(`in ~${fc.etaTurns}t`);
        return [{ label: fc.label, value: parts.join(" "), color: INK.ember }];
      }
      case "banked":
        return [{ label: fc.label, value: `+${fc.value} party · next battle`, color: INK.success }];
      case "tiered": {
        // "Morale Neutral → High" + a couple of headline modifiers from the bundle.
        const rows: CardRow[] = [{ label: fc.label, value: `${fc.from} → ${fc.to}`, color: INK.success, emphasize: true }];
        const m = fc.modifiers;
        if (m.initiativeBonus) rows.push({ label: "Initiative", value: `+${m.initiativeBonus}`, color: INK.gold });
        if (m.safeDepthBonus) rows.push({ label: "Safe depth", value: `+${m.safeDepthBonus}`, color: INK.gold });
        if (fc.banked) rows.push({ label: "Banked heal", value: `+${fc.banked} · next battle`, color: INK.success });
        return rows;
      }
      case "branching":
        // One row per herb, greyed when unavailable, the rider tag appended (D64).
        return fc.rows.map((r) => ({
          label: r.label,
          value: `+${r.value}${r.rider ? ` ${r.rider}` : ""}`,
          color: r.available ? INK.secondary : INK.disabled,
        }));
    }
  }

  private highlightTile(coord: GridCoord | null): void {
    this.view.highlightTile(this.highlight, coord);
  }

  // --- Buttons ---------------------------------------------------------------

  private makeTextButton(x: number, y: number, w: number, h: number, text: string, fill: number, stroke: number, onClick: () => void, description?: string): Button {
    const btn = new Button(this, x, y, {
      text,
      w,
      h,
      fill,
      stroke,
      onClick,
      hint: { bar: this.hintPanel, description, idle: () => this.lastHint },
    });
    this.add.existing(btn).setDepth(12);
    return btn;
  }

  private setPrimary(text: string, visible = true): void {
    this.primary.setLabel(text).setVisible(visible);
  }

  /** The resting Y of the End Turn / Advance Clock primary — the box's bottom slot. */
  private primaryRestY(): number {
    return this.scale.height - 40;
  }

  private clearActionButtons(): void {
    clearLayer(this.actionButtons);
    // With no command menu up, the primary (End Turn / Advance Clock / …) stands alone,
    // bottom-left; layoutActionMenu re-docks it into the box's bottom slot.
    this.primary?.setPosition(MENU_CX, this.primaryRestY());
  }

  /**
   * Lay the unit's verbs as a **vertical command menu** (D-UX): a translucent box of
   * stacked, full-width buttons docked **bottom-left**, with the green End Turn /
   * Advance Clock primary **docked as the bottom entry** so the whole command cluster —
   * verbs and the turn's close — sits in one place and the pointer barely travels
   * between choices (the traditional tactics command box, vs. the old wide row). Reads
   * top to bottom in the order the callers build them. Shared by both phases and the
   * herb submenu, so every in-combat menu looks and sits the same. The backing box is
   * tracked with the buttons; {@link clearActionButtons} tears it down and floats the
   * primary back to its lone resting spot.
   */
  private layoutActionMenu(specs: { text: string; description?: string; onClick: () => void }[]): void {
    this.clearActionButtons();
    if (specs.length === 0) return;
    const cx = MENU_CX;
    const dockPrimary = this.primary.visible;
    // The primary docks as the bottom slot; the verbs stack above it.
    const slots = specs.length + (dockPrimary ? 1 : 0);
    const bottomY = this.primaryRestY();
    const topY = bottomY - (slots - 1) * MENU_PITCH;
    const box = this.add
      .rectangle(cx, (topY + bottomY) / 2, MENU_BW + 2 * MENU_PAD, (slots - 1) * MENU_PITCH + MENU_BH + 2 * MENU_PAD, COLOR.surface, 0.85)
      .setStrokeStyle(1, COLOR.borderSoft)
      .setDepth(11);
    this.actionButtons.push(box);
    specs.forEach((spec, i) => {
      this.actionButtons.push(this.makeTextButton(cx, topY + i * MENU_PITCH, MENU_BW, MENU_BH, spec.text, COLOR.btnFill, COLOR.btnStroke, spec.onClick, spec.description));
    });
    if (dockPrimary) this.primary.setPosition(cx, topY + specs.length * MENU_PITCH);
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
