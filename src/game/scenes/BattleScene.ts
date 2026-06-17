import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import { roleColor } from "../roles";
import { CombatView } from "../combat-view";
import { addVignette } from "../vignette";
import {
  planMove,
  planAttack,
  findPath,
  occupiedGrid,
  isAdjacent,
  TileGrid,
  TILE_HEIGHT,
  Battle,
  unitSkills,
  unlockedSkills,
  isValidSkillTarget,
  makeTrap,
  canSee,
  // M5b/D11 — deployment: the shared stealth-alert model
  removeItem,
  countOf,
  slotsUsed,
  safeDepth,
  freeCaptive,
  captureUnit,
  createAlert,
  resolveDeployAction,
  streamFor,
  // M5 — camp / morale
  moraleTier,
  moraleModifiers,
  // D32/D53 — the survivalist levels from laying traps (its signature deploy action)
  grantAbilityUseXp,
  // M6 — the run loop
  currentEncounter,
  isAuthoredEncounter,
  encounterOutcome,
  jobLevelOf,
  computeUpkeep,
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
  type ConcealedTrap,
  bribeEnemy,
  bribeCost,
  recruitToRoster,
  type RunState,
  type RunLoop,
  type IntelReport,
  type IntelTier,
  type DeployAlert,
  type DeployOutcome,
  type Rng,
  type GridCoord,
  type Unit,
  type Side,
  type SkillDef,
  type TheftAttempt,
} from "../../core";
import type { RunHandoff } from "./OverworldScene";
import { Button } from "../button";
import { HintPanel } from "../hint-panel";
import { dropNet as dropNetCage } from "../deploy-fx";

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

  // Deployment state (D11): a shared camp-alert meter + a seeded roll stream.
  private deployActor: Unit | null = null;
  private deployAlert: DeployAlert = createAlert();
  private deployRng!: Rng;
  private placedTraps: { pos: GridCoord; damage: number; marker: Phaser.GameObjects.Text; sprung: boolean }[] = [];
  private trapDamage = 12;
  // D12 — concealed enemy traps: a seeded spot-roll stream + per-trap board markers.
  private spotRng!: Rng;
  private trapMarkers = new Map<string, Phaser.GameObjects.Text>();
  private intel?: IntelReport;

  // Battle interaction.
  private waitingFor: Unit | null = null;
  private armedSkill: SkillDef | null = null;
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
    this.view.reduceMotion = !!(window as Window & { __SHOT__?: boolean }).__SHOT__;
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
    // T toggles the danger-zone overlay (every tile an enemy could hit this turn).
    this.input.keyboard?.on("keydown-T", () => { this.showThreat = !this.showThreat; this.drawPreview(); });

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
    for (const o of this.overlay) o.destroy();
    this.overlay = [];

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
    this.placedTraps = [];
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
    for (const o of this.boardObjects) o.destroy();
    this.boardObjects = [];
    this.view.clearUnits();
    this.gridGfx?.destroy();
    this.safeZoneGfx?.destroy();
    this.safeZoneGfx = undefined;
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
    this.deployAlert = createAlert();
    this.deployRng = streamFor(this.run.seed, "deploy");
    this.spotRng = streamFor(this.run.seed, "trap-spot");
    this.trapMarkers.clear();
    const trapSkill = this.run.party
      .flatMap((u) => unitSkills(u, "deployment"))
      .find((s) => s.effect.kind === "placeTrap");
    if (trapSkill && trapSkill.effect.kind === "placeTrap") this.trapDamage = trapSkill.effect.damage;
    this.selectDeployActor(this.battle.units.find((u) => u.side === "player") ?? null);
    this.setPrimary("Start Battle");
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
    this.deployActor = unit;
    this.highlightTile(unit ? unit.pos : null);
    this.drawSafeZone(unit);
    this.refreshDeployButtons();
    this.refreshDeployStatus();
    if (unit) {
      this.setHint(`${unit.name}: click a tile to move (deeper = riskier), place a trap where you stand, or pick another unit.`);
    }
  }

  private refreshDeployButtons(): void {
    const actor = this.deployActor;
    const specs: { text: string; description?: string; onClick: () => void }[] = [];
    if (actor && !actor.captured && unitSkills(actor, "deployment").some((s) => s.effect.kind === "placeTrap")) {
      specs.push({
        text: "Place Trap Here",
        description: "Drop a trap on this tile (1 kit). Deeper tiles raise capture risk.",
        onClick: () => this.placeTrap(),
      });
    }
    if (this.battle.units.filter((u) => u.side === "player" && !u.captured).length > 1) {
      specs.push({ text: "Next Unit", description: "Switch to another unit to deploy.", onClick: () => this.cycleDeployActor() });
    }
    this.layoutActionRow(specs);
  }

  private cycleDeployActor(): void {
    if (this.busy) return;
    const players = this.battle.units.filter((u) => u.side === "player" && !u.captured);
    if (players.length === 0) return;
    const i = this.deployActor ? players.indexOf(this.deployActor) : -1;
    this.selectDeployActor(players[(i + 1) % players.length]);
  }

  private depthOf(tile: GridCoord): number {
    return tile.col;
  }

  private refreshDeployStatus(): void {
    const actor = this.deployActor;
    if (!actor) {
      this.titleText.setText("Deployment");
      return;
    }
    const mods = this.deployMods();
    const past = Math.max(0, this.depthOf(actor.pos) - safeDepth(actor, mods.safeDepthBonus));
    const kits = countOf(this.run.inventory, "trap-kit");
    const tag = actor.captured ? " — CAPTURED" : past > 0 ? ` — ${past} past safe` : " — in cover";
    this.titleText.setText(`Deployment — ${actor.name}${tag} · camp alert ${this.deployAlert.meter}% · Trap Kits ${kits}`);
  }

  private drawSafeZone(unit: Unit | null): void {
    if (!this.safeZoneGfx) {
      this.safeZoneGfx = this.add.graphics().setDepth(0.4);
      this.boardObjects.push(this.safeZoneGfx);
    }
    this.safeZoneGfx.clear();
    if (!unit) return;
    const maxCol = safeDepth(unit, this.deployMods().safeDepthBonus);
    for (let row = 0; row < this.grid.rows; row++) {
      for (let col = 0; col <= maxCol && col < this.grid.cols; col++) {
        if (!this.grid.isWalkable({ col, row })) continue;
        const { x, y } = this.tileToWorld({ col, row });
        const halfW = this.view.halfW();
        const halfH = this.view.halfH();
        this.safeZoneGfx.fillStyle(COLOR.successDeep, 0.28);
        this.safeZoneGfx.beginPath();
        this.safeZoneGfx.moveTo(x, y - halfH);
        this.safeZoneGfx.lineTo(x + halfW, y);
        this.safeZoneGfx.lineTo(x, y + halfH);
        this.safeZoneGfx.lineTo(x - halfW, y);
        this.safeZoneGfx.closePath();
        this.safeZoneGfx.fillPath();
      }
    }
  }

  private deployMove(tile: GridCoord): void {
    const actor = this.deployActor;
    if (!actor || actor.captured || this.busy) return;
    const nav = occupiedGrid(this.grid, this.battle.units, [actor]);
    const path = findPath(nav, actor.pos, tile);
    if (!path || path.length < 2) {
      this.setHint("Can't move there.");
      return;
    }
    const steps = path.slice(1).slice(0, actor.moveRange);
    actor.pos = { ...steps[steps.length - 1] };
    this.busy = true;
    this.animateMove(actor, steps, () => {
      this.busy = false;
      this.highlightTile(actor.pos);
      this.resolveDeploy(actor);
    });
  }

  /** Resolve a noisy deploy action (move or deep trap) via the shared core model. */
  private resolveDeploy(actor: Unit): void {
    const outcome = resolveDeployAction(this.deployAlert, actor, this.grid, this.battle.units, this.deployRng, this.deployMods().safeDepthBonus);
    if (outcome.spotted) this.playRetreat(actor, outcome);
    else {
      this.refreshDeployStatus();
      this.refreshDeployButtons();
    }
  }

  /** Animate a spotted unit bolting for cover along the resolver's planned path. */
  private playRetreat(unit: Unit, outcome: DeployOutcome): void {
    this.setHint(`${unit.name} was spotted — bolting for cover!`);
    if (outcome.retreatPath.length === 0) {
      this.refreshDeployStatus();
      this.refreshDeployButtons();
      return;
    }
    this.walkRetreat(unit, outcome.retreatPath, outcome.capturedAt, 0);
  }

  /** Step the retreat one tile at a time; net the unit at the planned capture index. */
  private walkRetreat(unit: Unit, path: readonly GridCoord[], capturedAt: number, i: number): void {
    if (i >= path.length) {
      this.busy = false;
      this.highlightTile(unit.pos);
      this.setHint(`${unit.name} slipped back into cover — camp alert eased to ${this.deployAlert.meter}%.`);
      this.refreshDeployStatus();
      this.refreshDeployButtons();
      return;
    }
    this.busy = true;
    unit.pos = { ...path[i] };
    this.animateMove(unit, [path[i]], () => {
      this.placeView(unit);
      if (i === capturedAt) return this.netCapture(unit);
      this.walkRetreat(unit, path, capturedAt, i + 1);
    });
  }

  /** Netted mid-retreat: drop the net, then bind the unit in the enemy zone. */
  private netCapture(unit: Unit): void {
    captureUnit(unit);
    this.dropNet(unit);
    this.busy = false;
    this.captureDuringDeploy(unit);
  }

  /** Drop the capture-net cage on a unit's tile (shared deploy FX). */
  private dropNet(unit: Unit): void {
    const { x, y } = this.tileToWorld(unit.pos);
    this.boardObjects.push(dropNetCage(this, x, y - this.view.halfH()));
  }

  private placeTrap(): void {
    const actor = this.deployActor;
    if (!actor || actor.captured || this.busy) return;
    if (countOf(this.run.inventory, "trap-kit") <= 0) {
      this.setHint("No trap kits carried — load some in camp first.");
      return;
    }
    const tile = actor.pos;
    if (this.placedTraps.some((t) => t.pos.col === tile.col && t.pos.row === tile.row)) {
      this.setHint("There's already a trap here — move first.");
      return;
    }
    removeItem(this.run.inventory, "trap-kit", 1);
    const { x, y } = this.tileToWorld(tile);
    const marker = this.add.text(x, y - this.view.halfH(), "✸", { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(0.8);
    this.boardObjects.push(marker);
    this.placedTraps.push({ pos: { ...tile }, damage: this.trapDamage, marker, sprung: false });
    // The signature deploy action levels its owner now (D32/D53).
    const levels = grantAbilityUseXp(actor);
    this.refreshCampText();
    this.setHint(levels > 0
      ? `Trap placed — ${actor.name} reached L${actor.level}! Range back or Start Battle.`
      : "Trap placed. A deep one is noisy — range back or Start Battle.");
    // A trap laid past the safe zone is a noisy action too, so it rolls a spot.
    this.resolveDeploy(actor);
  }

  private captureDuringDeploy(unit: Unit): void {
    unit.pos = { col: this.grid.cols - 2, row: this.grid.rows - 1 };
    this.placeView(unit);
    this.tintCaptured(unit, true);
    this.highlightTile(null);
    const next = this.battle.units.find((u) => u.side === "player" && !u.captured && u !== unit);
    this.selectDeployActor(next ?? null);
    this.setHint(`${unit.name} was netted mid-retreat! She starts the battle bound in the enemy zone — rescue her, or win to bring her home.`);
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
    this.highlightTile(null);

    this.placedTraps.forEach((t, i) => this.battle.entities.register(makeTrap(`trap-${i}`, t.pos, "player", t.damage)));
    this.battle.bus.on("unitEnterTile", ({ unit, tile }) => {
      if (unit.side !== "enemy") return;
      const t = this.placedTraps.find((t) => !t.sprung && t.pos.col === tile.col && t.pos.row === tile.row);
      if (t) {
        t.sprung = true;
        t.marker.setText("✺").setColor(INK.disabled);
        this.tweens.add({ targets: t.marker, scale: 1.8, duration: 140, yoyo: true });
      }
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
      ? "Traps are seeded ahead — watch for ⚠, and let a trapper disarm them. "
      : "";
    this.setHint((healed > 0 ? `Chef's stew restored ${healed} HP. ` : "Battle begins. ") + trapHint + (bound ? `${bound.name} is bound — rescue or win to free her. ` : "") + "Press Advance Clock.");
  }

  private onPrimary(): void {
    if (this.phase === "deployment") this.startBattle();
    else if (this.phase === "battle") this.onAdvance();
    else if (this.phase === "resolution") this.returnToOverworld();
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
      this.waitingFor = actor;
      // The active unit looks around — an Awareness roll may spot nearby traps (D12).
      this.spotTrapsForActor(actor);
      this.setHint(`${actor.name}'s turn — move, attack, or use a skill.`);
      this.showSkillButtons(actor);
      this.drawPreview();
    }
  }

  private showSkillButtons(actor: Unit): void {
    // Level-gated actives (D39): a 2nd active unlocks as the job levels — so combat
    // growth shows up here, in every fight (the converged renderer).
    const skills = unlockedSkills(actor, "battle");
    const specs = skills.map((skill) => ({ text: skill.name, description: `${skill.name} — ${skill.description}`, onClick: () => this.onSkillButton(actor, skill) }));
    // The Noble's mid-combat BRIBE (D30/D33): spend guild Influence to sway an enemy.
    if (this.guild && this.battle.units.some((u) => u.side === "enemy" && u.alive)) {
      const cost = bribeCost(this.currentPreview());
      const affordable = this.guild.influence >= cost;
      specs.push({
        text: `Bribe (${cost} Inf)`,
        description: affordable
          ? "Bribe an enemy (Noble Influence): a generic turns coat for the fight; an authored one joins the guild permanently."
          : `Not enough Influence (need ${cost}).`,
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
        description: "Spend the turn scanning the ground ahead for concealed traps (a wider, better look).",
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
    this.layoutActionRow(specs);
  }

  // --- Trap-field: spotting, searching, disarming (D12) ----------------------

  /** Roll the active unit's Awareness against nearby hidden traps; draw any spotted. */
  private spotTrapsForActor(actor: Unit, search = false): void {
    if (hiddenTraps(this.battle.entities).length === 0) return;
    const found = revealTrapsNear(actor, this.battle.entities, this.spotRng, { search });
    if (found.length > 0) {
      this.redrawTrapMarkers();
      this.setHint(`${actor.name} spots ${found.length} hidden trap${found.length > 1 ? "s" : ""}! (⚠)`);
    }
  }

  /** A revealed, un-sprung concealed trap adjacent to `actor` (the disarm target). */
  private adjacentRevealedTrap(actor: Unit): ConcealedTrap | undefined {
    return this.battle.entities
      .all()
      .filter(isConcealedTrap)
      .find((t) => t.revealed && !t.sprung && Math.max(Math.abs(t.pos.col - actor.pos.col), Math.abs(t.pos.row - actor.pos.row)) <= 1);
  }

  /** Spend the turn on a deliberate Search — a wider radius and a better spot roll. */
  private doSearch(actor: Unit): void {
    if (this.busy || this.waitingFor !== actor) return;
    this.spotTrapsForActor(actor, true);
    this.waitingFor = null;
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    this.battle.endTurn(actor, { acted: true });
    this.afterTurn();
  }

  /** Disarm a spotted adjacent trap (Survivalist), harvest its kit, end the turn. */
  private doDisarm(actor: Unit, trapId: string): void {
    if (this.busy || this.waitingFor !== actor) return;
    const res = disarmTrap(this.battle.entities, trapId, actor, this.run.inventory);
    if (!res.ok) return this.setHint(`Can't disarm: ${res.reason}`);
    this.redrawTrapMarkers();
    this.refreshCampText();
    this.waitingFor = null;
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    this.battle.endTurn(actor, { acted: true });
    this.afterTurn();
    this.setHint(res.harvested
      ? `${actor.name} disarms the trap and pockets a ${res.harvested}.`
      : `${actor.name} disarms the trap (storage full — the kit is lost).`);
  }

  /**
   * Sync the board markers to the concealed traps: a ⚠ on each revealed armed trap,
   * a faded ✕ once sprung, and nothing for disarmed (removed) ones.
   */
  private redrawTrapMarkers(): void {
    const traps = this.battle.entities.all().filter(isConcealedTrap);
    for (const t of traps) {
      if (!t.revealed) continue;
      let m = this.trapMarkers.get(t.id);
      if (!m) {
        const { x, y } = this.tileToWorld(t.pos);
        m = this.add.text(x, y - this.view.halfH(), "⚠", { color: "#e06b6b", fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(0.75);
        this.boardObjects.push(m);
        this.trapMarkers.set(t.id, m);
      }
      m.setText(t.sprung ? "✕" : "⚠").setColor(t.sprung ? INK.disabled : "#e06b6b");
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
    if (sprang) this.setHint("💥 A hidden trap sprang!");
  }

  /** The current combat node's banded preview (D24) — leverage for the Noble's bribe. */
  private currentPreview() {
    return previewNode(this.run, this.run.mapNodeId, scoutedTier(this.run.overworld, this.run.mapNodeId));
  }

  /** Spend guild Influence to sway an enemy (D30/D33). Consumes the actor's turn. */
  private doBribe(actor: Unit, foe: Unit): void {
    if (!this.guild) return;
    const res = bribeEnemy(this.guild, foe, this.currentPreview());
    this.bribeArmed = false;
    if (!res.applied) return this.setHint(`Can't bribe: ${res.reason}`);
    // Turncoat: flip the enemy to the player's side for the rest of the fight.
    (foe as unknown as { side: Side }).side = "player";
    const view = this.view.views.get(foe.id);
    view?.body.setFillStyle(COLOR.ally).setStrokeStyle(2, COLOR.allyEdge);
    if (res.outcome?.permanent) this.pendingRecruits.push(foe);
    this.waitingFor = null;
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    this.battle.endTurn(actor, { acted: true });
    this.afterTurn();
    if (!this.over) this.setHint(res.detail ?? `${foe.name} swayed.`);
  }

  private onSkillButton(actor: Unit, skill: SkillDef): void {
    if (this.busy || this.waitingFor !== actor) return;
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
    this.waitingFor = null;
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    let verb: string;
    if (skill.effect.kind === "med-heal" && herb) {
      // Spend the chosen herb on the target (D44 medic flow).
      const out = this.battle.useHeal(actor, skill, target, herb, this.run.inventory);
      verb = out.cleansed ? `cleanses ${out.cleansed}` : out.healed ? `heals ${out.healed}` : "no herb";
      this.flashHeal(target);
    } else {
      const outcome = this.battle.useSkill(actor, skill, target);
      if (skill.target === "self") this.flashHeal(target);
      else this.flashAttack(actor, target);
      verb = outcome.healed ? `heals ${outcome.healed}` : outcome.damage ? `hits for ${outcome.damage}` : outcome.status ? `applies ${outcome.status}` : "acts";
    }
    this.afterTurn();
    if (!this.over) this.setHint(`${actor.name} used ${skill.name} — ${verb}. Advance Clock.`);
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

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const tile = this.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid || !this.grid.inBounds(tile)) return;

    if (this.phase === "deployment") {
      if (this.busy) return;
      const clicked = this.battle.units.find((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row);
      if (clicked && clicked.side === "player" && !clicked.captured) this.selectDeployActor(clicked);
      else if (!clicked) this.deployMove(tile);
      return;
    }
    if (this.phase !== "battle") return;

    const actor = this.waitingFor;
    if (this.over || this.busy || !actor) return;
    const clicked = this.battle.units.find((u) => u.alive && u.pos.col === tile.col && u.pos.row === tile.row);

    if (this.bribeArmed) {
      if (clicked === actor) {
        this.bribeArmed = false;
        this.setHint(`${actor.name}'s turn — move, attack, or use a skill.`);
        return;
      }
      if (clicked && clicked.side === "enemy" && !clicked.captured) this.doBribe(actor, clicked);
      else this.setHint("Pick an enemy to bribe (or click yourself to cancel).");
      return;
    }

    if (this.armedSkill) {
      if (clicked === actor) {
        this.armedSkill = null;
        this.setHint(`${actor.name}'s turn — move, attack, or use a skill.`);
        this.drawPreview();
        return;
      }
      if (clicked && isValidSkillTarget(this.armedSkill, actor, clicked)) this.commitSkill(actor, this.armedSkill, clicked);
      else this.setHint("Not a valid target for that skill.");
      return;
    }

    if (clicked && clicked.captured && clicked.side === actor.side && clicked !== actor) this.playerRescueOrApproach(actor, clicked);
    else if (clicked && clicked.side !== actor.side && !clicked.captured) this.playerAttackOrApproach(actor, clicked);
    else if (!clicked && this.grid.isWalkable(tile)) this.playerMove(actor, tile);
  }

  private playerRescueOrApproach(actor: Unit, captive: Unit): void {
    if (isAdjacent(actor.pos, captive.pos)) return this.commitRescue(actor, [], captive);
    const nav = occupiedGrid(this.grid, this.battle.units, [actor, captive]);
    const path = findPath(nav, actor.pos, captive.pos);
    if (!path || path.length < 2) return this.setHint("No path to your captured ally.");
    const approach = path.slice(1, -1).slice(0, actor.moveRange);
    const dest = approach.length > 0 ? approach[approach.length - 1] : actor.pos;
    this.commitRescue(actor, approach, isAdjacent(dest, captive.pos) ? captive : null);
  }

  private commitRescue(actor: Unit, path: GridCoord[], captive: Unit | null): void {
    this.waitingFor = null;
    this.armedSkill = null;
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    if (path.length > 0) this.battle.moveUnit(actor, path);
    let freed = false;
    if (captive && isAdjacent(actor.pos, captive.pos)) {
      freeCaptive(captive);
      this.tintCaptured(captive, false);
      freed = true;
    }
    this.battle.endTurn(actor, { moved: path.length > 0, acted: freed });
    this.animateMove(actor, path, () => {
      if (freed) this.flashHeal(captive!);
      this.afterTurn();
      if (!this.over && freed) this.setHint(`${actor.name} freed ${captive!.name}! Advance Clock.`);
    });
  }

  private playerAttackOrApproach(actor: Unit, foe: Unit): void {
    const plan = planAttack(actor, foe, this.battle.units, this.grid);
    if (!plan) return this.setHint("No path to that foe.");
    this.commitPlayer(actor, plan.path, plan.attackTarget);
  }

  private playerMove(actor: Unit, tile: GridCoord): void {
    const path = planMove(actor, tile, this.battle.units, this.grid);
    if (!path) return this.setHint("Can't move there.");
    this.commitPlayer(actor, path, null);
  }

  private commitPlayer(actor: Unit, path: GridCoord[], target: Unit | null): void {
    this.waitingFor = null;
    this.armedSkill = null;
    this.busy = true;
    this.clearActionButtons();
    this.highlightTile(null);
    if (path.length > 0) this.battle.moveUnit(actor, path);
    if (target && target.alive) this.battle.attack(actor, target);
    this.battle.endTurn(actor, { moved: path.length > 0, acted: target !== null });
    this.animateMove(actor, path, () => {
      if (target) this.flashAttack(actor, target);
      this.afterTurn();
    });
  }

  private afterTurn(): void {
    this.busy = false;
    this.resolveTheftDeaths();
    this.checkTrapSprings(); // a move may have sprung a hidden trap — reveal + mark it
    this.refreshHud();
    this.highlightTile(null);
    this.view.clearPreview(this.preview);
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

    // Any thief still standing at the bell got away with its skim (D13/D21).
    let goldEscaped = 0;
    for (const [id, attempt] of this.theftAttempts) {
      if (attempt.resolved) continue;
      const thief = this.battle.units.find((u) => u.id === id);
      if (thief && thief.alive) goldEscaped += thiefEscapes(attempt);
    }

    const res = this.loop.resolve();

    // Mid-combat bribe → recruitment (D33): permanent (authored) turncoats join the
    // guild roster after the battle; generics were temporary (just fought it out).
    const recruited: string[] = [];
    if (this.guild) {
      for (const u of this.pendingRecruits) {
        if (recruitToRoster(this.guild, u)) recruited.push(u.name);
      }
    }

    this.refreshCampText();
    this.refreshHp();
    this.refreshObjectiveText();
    // Re-tint any freed allies.
    for (const u of this.run.party) if (!u.captured) this.tintCaptured(u, false);

    // Three-way graded terminal (D50/D51): win / objective-failure / wipe — each a
    // distinct overlay, all routed through the single loop.resolve() above.
    const won = res.result === "win";
    const title = won ? "Victory!" : res.result === "objective-failure" ? "Objective Failed — Retreat" : "Defeat";
    const good = won;
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

    this.showOverlay(title, lines.join("\n"), good, 480, 200);
    this.setHint(`Resolution — ${lines.join("  ")}`);
    // On any terminal (wipe / loss / run-complete) the overworld shows the end
    // screen; otherwise the player returns to the map to pick the next node.
    this.setPrimary(res.over ? (this.loop.isComplete() ? "See Results" : "Run Over") : "Return to Map");
  }

  /** Hand the run back to the overworld so the player can pick the next node. */
  private returnToOverworld(): void {
    this.scene.start("OverworldScene", { run: this.run, loop: this.loop, guild: this.guild, caravanId: this.caravanId } as RunHandoff);
  }

  private showOverlay(title: string, body: string, good: boolean, w = 480, h = 170): void {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
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
      else if (status === "met") parts.push(`✓ ${o.spec.label} — secured`);
      else if (prog !== undefined) parts.push(`⚠ ${o.spec.label} — ${Math.round(prog * 100)}%`);
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
    const tier = moraleTier(this.run.camp.morale);
    const up = computeUpkeep(this.run.party).total;
    this.campText.setText(
      `Night ${this.run.night + 1}  ·  Gold ${this.run.camp.gold}  ·  Morale ${tier} (${this.run.camp.morale})  ·  ` +
        `Storage ${slotsUsed(this.run.inventory)}/${this.run.inventory.storageCap}  ·  Kits ${countOf(this.run.inventory, "trap-kit")}  ·  RP ${this.run.rp}  ·  Upkeep ${up}g/night`,
    );
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
    this.view.drawPreview(this.preview, actor, this.battle.units, this.grid, this.armedSkill ?? undefined);
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
    for (const obj of this.actionButtons) obj.destroy();
    this.actionButtons = [];
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
    this.view.animateMove(unit, path, done, 150);
  }

  private flashAttack(attacker: Unit, target: Unit): void {
    this.view.flashHit(attacker, target);
  }

  private flashHeal(unit: Unit): void {
    this.view.flashHeal(unit);
  }
}
