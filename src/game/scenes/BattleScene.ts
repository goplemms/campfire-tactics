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
  forecastAttack,
  effectiveMove,
  isImmobilized,
  inAttackRange,
  refreshAuras,
  isAdjacent,
  TileGrid,
  TILE_HEIGHT,
  Battle,
  unitSkills,
  unlockedSkills,
  onSkillCooldown,
  DEFEND,
  isValidSkillTarget,
  canSee,
  chebyshev,
  // M5b/D11 — deployment: the shared stealth-alert model
  countOf,
  campReadoutLine,
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
  stepDistance,
  frontCaptureChance,
  // D63 Phase B — the pure deploy-flow decisions (headless, vitest-tested), so the
  // scene renders the choices instead of making them.
  frontTurnStage,
  deployActions,
  type DeployActionId,
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
  disarmTrap,
  canDisarm,
  playerTrapSkill,
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
  type GridCoord,
  type Unit,
  type Side,
  type SkillDef,
  type TheftAttempt,
} from "../../core";
import type { RunHandoff } from "./OverworldScene";
import { Button } from "../button";
import { isScreenshotMode, clearLayer } from "../ui";
import { HintPanel } from "../hint-panel";
import { dropNet as dropNetCage } from "../deploy-fx";
import { ICON } from "../icons";

/**
 * Board zoom for the real combat field (D-UX): enlarge tiles + tokens so details
 * (HP bars, nameplates, status pips) stand out — the procedural 8×6 board is
 * centred full-width and has the room. Applied via {@link CombatView.boardScale}.
 */
const BOARD_SCALE = 1.4;

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
  private boardObjects: Phaser.GameObjects.GameObject[] = [];
  private originX = 0;
  private originY = 0;
  /** Shared board geometry + grid/tile drawing (the converged combat presentation). */
  private view!: CombatView;

  // Persistent HUD.
  private titleText!: Phaser.GameObjects.Text;
  private campText!: Phaser.GameObjects.Text;
  private intelText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private orderText!: Phaser.GameObjects.Text;
  private hintPanel!: HintPanel;
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
  private trapEffect?: PlaceTrapEffect;
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
    this.titleText = this.add.text(this.scale.width / 2, 16, "", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.title }).setOrigin(0.5).setDepth(10);
    this.campText = this.add.text(this.scale.width / 2, 40, "", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0.5).setDepth(10);
    this.intelText = this.add.text(this.scale.width / 2, 60, "", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5).setDepth(10);
    this.orderText = this.add.text(10, 68, "", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setDepth(10);
    // Objective banner — a generic readout (label + gauge) under the intel line.
    this.objectiveText = this.add.text(this.scale.width / 2, 76, "", { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.body, align: "center" }).setOrigin(0.5).setDepth(11);
    this.hintPanel = new HintPanel(this);
    this.threatGfx = this.add.graphics().setDepth(0.36);
    this.preview = this.add.graphics().setDepth(0.4);
    this.highlight = this.add.graphics().setDepth(0.5);
    this.primary = this.makeTextButton(this.scale.width / 2, this.scale.height - 26, 200, 34, "", COLOR.successDeep, COLOR.success, () => this.onPrimary());
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
    this.deployRng = streamFor(this.run.seed, "deploy");
    this.spotRng = streamFor(this.run.seed, "trap-spot");
    this.trapMarkers.clear();
    this.playerTrapMarkers.clear();
    this.trapSeq = 0;
    // The party's Set Trap spec (damage + snare status) — resolved once in core (D11).
    this.trapEffect = playerTrapSkill(this.run.party);
    // Deploy verbs flow through the one interpreter now (D63): wire the run stash so
    // Battle's placeTrap action can spend kits, undoably, on the shared log.
    this.battle.setStash(this.run.inventory);
    // D63 — the closing net: the enemy is a single danger front that marches in from
    // its edge, with a Speed leaning toward the camp's fastest scout. Player units and
    // the front share one deployment CT clock, so a quick party earns more positioning
    // turns between net-closings. (Dig-in is unit state now, reset at staging.)
    const enemies = this.battle.units.filter((u) => u.side === "enemy");
    // The campfire's safe radius comes from party presence (D63), widened by the
    // morale/intel deploy edge (D8/D10) — a confident, well-scouted camp holds more.
    this.campfire = createCampfire(this.grid, this.battle.units);
    this.campfire.radius += this.deployMods().safeDepthBonus;
    this.front = createFront(this.grid, enemies);
    this.deployClock = new DeployClock(this.battle.units, this.front);
    this.deployClock.seed();
    this.drawZones();
    this.drawSourceMarkers();
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
    // Arm the shared action-log undo for the deploy turn (D63) — each move/dig-in/
    // trap becomes undoable back to the turn's start, exactly like a combat turn.
    this.battle.beginUndo();
    this.selectDeployActor(unit);
    this.setPrimary("End Turn");
    this.setHint(
      `${unit.name}'s turn — click a tile to reposition, Dig In, or place a trap, then End Turn (Space). ` +
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
    // resolveFrontTurn reads each unit's dugIn stance by default (D63).
    const out = resolveFrontTurn(this.front, this.battle.units, this.deployRng);
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
      this.setHint("The enemy has overrun the camp — battle begins!");
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
    // The *decision* of which verbs to surface is pure (deployActions, D63 Phase B);
    // the scene only maps each id to its label + handler (movement is a separate,
    // click-to-move budget, not a button).
    const canTrap = !!actor && unitSkills(actor, "deployment").some((s) => s.effect.kind === "placeTrap");
    const ids = deployActions({
      hasActor: !!actor,
      captured: !!actor?.captured,
      acted: this.deployActed,
      canUndo: this.battle.canUndo(),
      canTrap,
    });
    const make: Record<DeployActionId, { text: string; description?: string; onClick: () => void }> = {
      undo: {
        text: "Undo",
        description: "Take back everything this unit did this deploy turn — moves, dig-in, traps (kit refunded) — back to where it started (Esc).",
        onClick: () => { if (actor) this.undoDeployTurn(actor); },
      },
      digIn: {
        text: "Dig In",
        description: "Hunker on this tile — far lower capture chance when the net closes, at the cost of this turn.",
        onClick: () => this.digIn(),
      },
      placeTrap: {
        text: "Place Trap Here",
        description: "Drop a trap on this tile (1 kit). Deeper tiles raise capture risk.",
        onClick: () => this.placeTrap(),
      },
      startBattle: {
        text: "Start Battle",
        description: "Commit now — begin the fight with the party where it stands.",
        onClick: () => { if (!this.busy) this.startBattle(); },
      },
    };
    this.layoutActionRow(ids.map((id) => make[id]));
  }

  private refreshDeployStatus(): void {
    const actor = this.deployActor;
    const kits = countOf(this.run.inventory, "trap-kit");
    const reach = `enemy reach ${this.front?.radius ?? "—"}`;
    if (!actor) {
      this.titleText.setText(`Deployment — ${reach} · Trap Kits ${kits}`);
      return;
    }
    const inDanger = this.front && inDangerZone(actor.pos, this.front);
    const dug = actor.dugIn === true;
    const safe = this.front && this.campfire && inSafeZone(actor.pos, this.campfire, this.front);
    const tag = actor.captured
      ? " — CAPTURED"
      : inDanger
        ? ` — IN DANGER (${Math.round(frontCaptureChance(actor, this.front, { dugIn: dug }) * 100)}% if it grows)`
        : dug
          ? " — dug in"
          : safe
            ? " — safe by the fire"
            : " — exposed (neutral ground)";
    this.titleText.setText(`Deployment — ${actor.name}${tag} · ${reach} · Trap Kits ${kits}`);
  }

  /**
   * Paint the two influence zones (D63): green safe ground (inside the campfire,
   * not yet reached by the enemy), red danger (inside the enemy radius), and an
   * amber telegraph on the ring about to fall next turn. Party-wide — drawn only
   * when the sources actually change (enter / front turn), never per unit.
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
  }

  /** Which deployment band a walkable tile falls in (drives both fill and outline). */
  private zoneOf(t: GridCoord): "danger" | "warning" | "safe" | "none" {
    if (inDangerZone(t, this.front)) return "danger";
    if (stepDistance(t, this.front.origin) === this.front.radius + 1) return "warning";
    if (inSafeZone(t, this.campfire, this.front)) return "safe";
    return "none";
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
    let steps = path.slice(1).slice(0, actor.moveRange);
    while (steps.length > 0 && occupied.has(`${steps[steps.length - 1].col},${steps[steps.length - 1].row}`)) steps = steps.slice(0, -1);
    if (steps.length === 0) {
      this.setHint("Can't stop there — an ally holds the only tile in reach.");
      return;
    }
    // Route the reposition through the one interpreter (D63): it walks the path
    // (logged + undoable), springs any entity crossed, and breaks the dig-in stance.
    this.battle.deployMove(actor, steps);
    this.deployMoved = true;
    this.busy = true;
    this.animateMove(actor, steps, () => {
      this.busy = false;
      this.highlightTile(actor.pos);
      this.refreshDeployButtons();
      this.refreshDeployStatus();
      this.setHint(`${actor.name} repositioned. Dig In, place a trap, or End Turn (Space) to advance the net.`);
    });
  }

  /** Drop the capture-net cage on a unit's tile (shared deploy FX). */
  private dropNet(unit: Unit): void {
    const { x, y } = this.tileToWorld(unit.pos);
    this.boardObjects.push(dropNetCage(this, x, y - this.view.halfH()));
  }

  private placeTrap(): void {
    const actor = this.deployActor;
    if (!actor || actor.captured || this.busy || !this.trapEffect) return;
    // The rules (kit cost, tile clear, entity registration, use-XP) run through the
    // one interpreter now (D63: Battle.placeTrap → the logged, undoable placeTrap
    // action); the scene keeps only the board marker, keyed by entity id.
    const id = `ptrap-${this.trapSeq++}`;
    const res = this.battle.placeTrap(actor, actor.pos, this.trapEffect, id);
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
    this.titleText.setText("Battle");
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
    if (!actor) return this.finishBattle();
    // The clock tick inside nextActor may have closed a gate (D50) — re-poll.
    if (this.encounterDecided()) return this.finishBattle();
    this.revealScouted();
    this.highlightTile(actor.pos);
    this.refreshHud();
    // A hidden ambush body lies in wait — it doesn't act until the party scouts it
    // into view (D42/D44 fog); it just passes its turn.
    if (actor.hidden) {
      this.battle.endTurn(actor, {});
      this.setHint("Something stirs in ambush ahead… scout it out.");
      return;
    }
    if (actor.side === "enemy") {
      this.runEnemyTurn(actor);
    } else {
      this.beginPlayerTurn(actor);
    }
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
    this.moveBudget = isImmobilized(actor) ? 0 : effectiveMove(actor);
    this.acted = false;
    this.actCharged = false;
    this.movedThisTurn = false;
    this.turnLocked = false;
    // Arm the action-log undo for the turn (D60 take-back) — every move/strike/skill
    // the unit makes becomes undoable back to this point, until the turn commits.
    this.battle.beginUndo();
    this.hoverTile = null;
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
    const units = this.battle.units;
    const budget = isImmobilized(actor) ? 0 : effectiveMove(actor);
    if (reachableTiles(actor, units, this.grid, budget).some((r) => r.tile.col !== actor.pos.col || r.tile.row !== actor.pos.row)) return false;
    if (units.some((u) => u.alive && !u.captured && u.side !== actor.side && forecastAttack(actor, u, units, this.grid))) return false;
    if (units.some((u) => u.captured && u.side === actor.side && u !== actor && isAdjacent(actor.pos, u.pos))) return false;
    if (unlockedSkills(actor, "battle").length > 0) return false;
    if (hiddenTraps(this.battle.entities).length > 0) return false; // Search is available
    if (this.adjacentRevealedTrap(actor) && canDisarm(actor)) return false;
    if (this.guild && units.some((u) => u.side === "enemy" && u.alive)) return false; // Bribe
    return true;
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
      unlockedSkills(actor, "battle").forEach((skill, i) => {
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
      // (D62) to sway an enemy. A permanent recruit still banks to the guild roster.
      if (this.guild && this.battle.units.some((u) => u.side === "enemy" && u.alive)) {
        const tier = influenceTier(this.run.overworld.influence);
        const cost = bribeCost(this.currentPreview(), tier);
        const chance = Math.round(bribeChance(tier) * 100);
        const affordable = this.run.overworld.influence >= cost;
        specs.push({
          text: "Bribe",
          description: affordable
            ? `Sway an enemy for ${cost} Influence — ~${chance}% at ${tier} standing (a failed roll still spends the Influence and the Act). A generic turns coat for the fight; an authored one joins the guild permanently.`
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
      specs.push({ text: "Defend (D)", description: `${DEFEND.description}  ·  key D.`, onClick: () => this.onSkillButton(actor, DEFEND) });
    }
    // End Turn (W) — the explicit close, mirroring the prominent primary button so a
    // unit is never stuck and the turn never ends without a deliberate press (D60).
    specs.push({ text: "End Turn (W)", description: "End this unit's turn (spends the move/Act it actually used). Also the green button below, Space, or W.", onClick: () => this.endPlayerTurn(actor) });
    this.layoutActionRow(specs);
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
    return this.battle.entities
      .all()
      .filter(isConcealedTrap)
      .find((t) => t.revealed && !t.sprung && chebyshev(t.pos, actor.pos) <= 1);
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
      this.layoutActionRow(
        herbs.map((h) => ({
          text: `${h} (${countOf(this.run.inventory, h)})`,
          description: `Heal with ${h}.`,
          onClick: () => {
            this.pendingHerb = h;
            this.armedSkill = skill;
            this.setHint(`Heal (${h}): click a wounded ally (or click ${actor.name} to cancel).`);
            this.drawPreview();
          },
        })),
      );
      return;
    }
    if (skill.target === "self") return this.commitSkill(actor, skill, actor);
    this.armedSkill = skill;
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
      const skills = unlockedSkills(actor, "battle");
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
      "DEPLOYMENT (the closing net): green = your campfire's safe ground (wider with",
      "  a stronger party); red = the enemy's danger, growing each time it acts (amber",
      "  = the ring about to fall). On a unit's turn: move to pull back, Dig In to",
      "  hunker (far safer), or set a trap — then End Turn (Space). Between turns press",
      "  Advance Clock (Space) to let the danger grow. A unit caught inside it may be",
      "  captured — the first capture raises the alarm and the battle begins.",
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
      // Turn-based deployment (D63): only the unit whose turn it is may act, and
      // clicking an empty tile repositions it (the clock dictates the order).
      if (this.busy || !this.deployActor) return;
      const clicked = this.battle.units.find((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row);
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
   * Hover routing (D60): while a player unit is waiting, light the route to the tile
   * under the cursor (FE-style path read) and float the cursor highlight there. A
   * cheap reach lookup — no pathfinding per move — so it can run every frame.
   */
  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.phase !== "battle" || this.busy || this.over || !this.waitingFor) return;
    if (this.armedSkill || this.bribeArmed || this.pendingHerb) return;
    const tile = this.grid?.inBounds(this.worldToTile(pointer.worldX, pointer.worldY))
      ? this.worldToTile(pointer.worldX, pointer.worldY)
      : null;
    const reachable = tile ? this.reachByKey.get(`${tile.col},${tile.row}`) : undefined;
    const next = reachable && reachable.path.length > 0 ? tile : null;
    if ((next?.col ?? -1) === (this.hoverTile?.col ?? -1) && (next?.row ?? -1) === (this.hoverTile?.row ?? -1)) return;
    this.hoverTile = next;
    this.highlightTile(next ?? this.waitingFor.pos);
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
    const hpBefore = actor.hp;
    this.busy = true;
    this.armedSkill = null;
    this.clearActionButtons();
    this.highlightTile(null);
    this.hoverTile = null;
    this.battle.moveUnit(actor, r.path);
    this.movedThisTurn = true;
    this.moveBudget -= r.cost;
    this.animateMove(actor, r.path, () => {
      this.checkTrapSprings();
      this.refreshHud();
      if (!actor.alive || this.encounterDecided()) {
        this.busy = false;
        return this.afterTurn();
      }
      if (actor.hp < hpBefore) this.turnLocked = true; // a trap bit — the move stands
      this.afterActionContinue(actor);
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
    this.moveBudget = isImmobilized(actor) ? 0 : effectiveMove(actor);
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

    const { title, good, lines } = this.buildResolutionSummary(res, goldEscaped, recruited);
    this.showOverlay(title, lines.join("\n"), good, 480, 200);
    this.setHint(`Resolution — ${lines.join("  ")}`);
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
   * as a title, tone, and the body lines (rewards, casualties, level-ups, theft +
   * recruitment outcomes). Pure assembly off the resolved result; shows nothing.
   */
  private buildResolutionSummary(
    res: ResolveResult,
    goldEscaped: number,
    recruited: string[],
  ): { title: string; good: boolean; lines: string[] } {
    const won = res.result === "win";
    const title = won ? "Victory!" : res.result === "objective-failure" ? "Objective Failed — Retreat" : "Defeat";
    const lines: string[] = [];
    if (won) {
      lines.push(`+${res.goldEarned} gold.`);
      if (res.rescued.length) lines.push(`Auto-rescued ${res.rescued.join(", ")} (won the field).`);
      lines.push(res.recovered.length ? `Recovered ${res.recovered.length} unsprung trap kit(s).` : "No unsprung materials.");
    } else if (res.result === "objective-failure") {
      lines.push("The objective was lost — the party retreats alive, the prize forfeited.");
    } else {
      lines.push("The party was overwhelmed.");
    }
    // Casualties apply on either survivable outcome (D51).
    if (res.result !== "wipe") {
      if (res.downed.length) lines.push(`Downed: ${res.downed.map((d) => `${d.unitId} (${d.resolution})`).join(", ")}.`);
      if (res.permadeaths.length) lines.push(`Lost forever: ${res.permadeaths.join(", ")}.`);
    }
    // Captives left behind become rescue follow-ups (D9/D21) — name them so the
    // abandonment isn't silently dropped; the Captain's Journal keeps nagging after.
    if (res.rescueQuests.length) {
      lines.push(`Captured — needs rescue: ${res.rescueQuests.map((q) => q.unitId).join(", ")}.`);
    }
    // Level-up feedback (D53): who reached a new job level, with their new actives.
    for (const u of this.battle.units) {
      if (u.side !== "player") continue;
      const was = this.preBattleJobLevels.get(u.id) ?? jobLevelOf(u, u.primaryJob);
      const now = jobLevelOf(u, u.primaryJob);
      if (now > was) {
        const actives = unlockedSkills(u, "battle").map((s) => s.name).join(", ");
        lines.push(`${u.name} reached job L${now} — actives: ${actives || "—"}.`);
      }
    }
    if (won && this.loop.isComplete()) lines.push("The final mission is cleared — the run is complete!");
    // Theft + recruitment outcomes (M10).
    if (this.goldStolen > 0) {
      lines.push(`Thieves skimmed ${this.goldStolen}g — recovered ${this.goldRecovered}g${goldEscaped > 0 ? `, ${goldEscaped}g escaped` : ""}.`);
    }
    if (recruited.length) lines.push(`Swayed to the guild (permanent): ${recruited.join(", ")}.`);
    return { title, good: won, lines };
  }

  /** Hand the run back to the overworld so the player can pick the next node. */
  private returnToOverworld(): void {
    this.scene.start("OverworldScene", { run: this.run, loop: this.loop, guild: this.guild, caravanId: this.caravanId } as RunHandoff);
  }

  private showOverlay(title: string, body: string, good: boolean, w = 480, h = 170): void {
    clearLayer(this.overlay);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.92).setStrokeStyle(2, good ? COLOR.success : COLOR.danger).setDepth(20),
      this.add.text(cx, cy - h / 2 + 28, title, { color: good ? INK.success : INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(cx, cy + 14, body, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, align: "center", lineSpacing: 4 }).setOrigin(0.5).setDepth(21),
    );
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
    // the acting unit lit, each carrying side/role, HP and the CT readout.
    this.orderText.setText("Turn order");
    this.view.drawInitiative(this.battle.units, 8, 84, (u) => this.battle.clock.isCharging(u));
    this.refreshHp();
    this.refreshObjectiveText();
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

  private refreshCampText(): void {
    // Format owned by core (campReadoutLine) — the battle HUD adds only the Night prefix.
    this.campText.setText(campReadoutLine(this.run, { night: this.run.night + 1 }));
  }

  private refreshIntelText(): void {
    const r = this.intel;
    if (!r) {
      this.intelText.setText("");
      return;
    }
    const parts = [`Intel T${r.tier}`];
    if (r.types) parts.push(`types: ${r.types.join(", ")}`);
    if (r.count !== undefined) parts.push(`count: ${r.count}`);
    if (r.grantsVision) parts.push("starting vision");
    const def = currentEncounter(this.run);
    const shape = isAuthoredEncounter(def) ? "authored" : def.type;
    this.intelText.setText(`${parts.join("  ·  ")}   (${shape})`);
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
      return;
    }
    if (this.showThreat) this.view.drawThreatZone(this.threatGfx, this.battle.units, this.grid, "player");
    else this.threatGfx.clear();
    const hoverPath = this.hoverTile ? this.reachByKey.get(`${this.hoverTile.col},${this.hoverTile.row}`)?.path : undefined;
    this.view.drawPreview(this.preview, actor, this.battle.units, this.grid, {
      armed: this.armedSkill ?? undefined,
      moveBudget: this.moveBudget,
      acted: this.acted,
      hoverPath,
    });
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

  private clearActionButtons(): void {
    clearLayer(this.actionButtons);
  }

  private layoutActionRow(specs: { text: string; description?: string; onClick: () => void }[]): void {
    this.clearActionButtons();
    if (specs.length === 0) return;
    const y = this.scale.height - 66;
    const gap = Math.min(150, 720 / specs.length);
    const startX = this.scale.width / 2 - ((specs.length - 1) * gap) / 2;
    specs.forEach((spec, i) => {
      this.actionButtons.push(this.makeTextButton(startX + i * gap, y, gap - 12, 30, spec.text, COLOR.btnFill, COLOR.btnStroke, spec.onClick, spec.description));
    });
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
