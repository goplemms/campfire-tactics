import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import {
  planMove,
  planAttack,
  findPath,
  occupiedGrid,
  TILE_HEIGHT,
  DemoRunner,
  unlockedSkills,
  isValidSkillTarget,
  effectiveMove,
  computeFlankBonus,
  safeDepth,
  captureUnit,
  createAlert,
  resolveDeployAction,
  streamFor,
  type DeployAlert,
  type DeployOutcome,
  type Rng,
  jobLevelOf,
  canSee,
  countOf,
  addItem,
  slotsUsed,
  DEFEND,
  type Unit,
  type GridCoord,
  type SkillDef,
  type StagedEncounter,
  type EncounterResult,
} from "../../core";
import { Button, ButtonColumn } from "../button";
import { HintPanel } from "../hint-panel";
import { CombatView } from "../combat-view";
import { addVignette } from "../vignette";
import { dropNet as dropNetCage } from "../deploy-fx";

/**
 * Standalone **demo mode** (D44): plays *The Hollow Mill* end to end, bypassing
 * the guild/overworld. It drives a {@link DemoRunner} beat by beat — Provision →
 * (interactive) encounters with the four kits, charge/cooldown/channel readouts,
 * status trackers, Defend, and the bridge-cut timer → a Rest/level-up screen with
 * the deserter choice → graded-failure results. The combat rules all live in
 * `core`; this scene only renders + dispatches.
 */
export class DemoScene extends Phaser.Scene {
  private runner!: DemoRunner;
  private staged?: StagedEncounter;

  private originX = 0;
  private originY = 0;
  /** Shared board geometry + grid/tile drawing (the seam shared with BattleScene). */
  private view!: CombatView;
  /**
   * The right-hand vertical command panel sizes itself to its labels: short sets
   * (Dash / Defend) stay snug at {@link panelMinW}, while a long label (a kit name
   * plus a `[cd N]` tag, `+ stimulant (have 0)`) grows the panel *leftward* into
   * the empty gap beside the board rather than shrinking the text to fit. The
   * board always reserves the {@link panelMaxW} band on the right, so even a
   * fully-grown panel never hides a far-right tile.
   */
  private readonly panelMinW = 150;
  private readonly panelMaxW = 196;
  private gridGfx?: Phaser.GameObjects.Graphics;
  private highlight!: Phaser.GameObjects.Graphics;
  /** Move-range / attack / valid-target preview, painted on the player's turn. */
  private preview!: Phaser.GameObjects.Graphics;
  /** The danger-zone overlay (toggle with T) and whether it's on. */
  private threatGfx!: Phaser.GameObjects.Graphics;
  private showThreat = false;
  /** A bobbing chevron over the unit currently taking its turn. */
  private activeMarker!: Phaser.GameObjects.Triangle;
  private boardObjects: Phaser.GameObjects.GameObject[] = [];
  /** Bus unsubscribers for the active encounter (floating combat text). */
  private busUnsubs: (() => void)[] = [];

  private titleText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  /** Header label above the shared initiative rail (the rail itself lives in CombatView). */
  private orderText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private hintPanel!: HintPanel;
  private lastHint = "";
  private primary!: Button;
  /** The current right-hand command panel (kit abilities / provision / choices), if any. */
  private commandPanel?: ButtonColumn;
  private overlay: Phaser.GameObjects.GameObject[] = [];

  // Deployment (M5b/D11): reposition before each fight. Pushing a unit past its
  // safe depth raises a shared camp-alert meter; on a spot the unit bolts for
  // cover, risking capture along the way. Rolls use a seeded, reproducible stream.
  private deploying = false;
  private deployActor: Unit | null = null;
  private deployAlert: DeployAlert = createAlert();
  private deployRng!: Rng;

  // Battle interaction.
  private waitingFor: Unit | null = null;
  private armed: SkillDef | null = null;
  private pendingHerb: string | null = null;
  private busy = false;
  private ended = false;
  /** Set by the screenshot harness (window.__SHOT__) to freeze perpetual motion. */
  private readonly reduceMotion = !!(window as Window & { __SHOT__?: boolean }).__SHOT__;

  constructor() {
    super("DemoScene");
  }

  create(): void {
    this.runner = new DemoRunner();
    this.view = new CombatView(this);
    this.view.reduceMotion = this.reduceMotion;
    // The campfire glow — a warm vignette over the board, beneath the tokens/HUD.
    addVignette(this);
    this.titleText = this.add.text(this.scale.width / 2, 14, "", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.title }).setOrigin(0.5).setDepth(10);
    this.subText = this.add.text(this.scale.width / 2, 38, "", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5).setDepth(10);
    // Header above the shared initiative rail (drawn by CombatView in refreshHud).
    this.orderText = this.add.text(10, 68, "", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setDepth(10);
    this.timerText = this.add.text(this.scale.width / 2, 58, "", { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0.5).setDepth(10);
    // A collapsible top-right card consolidates contextual tips and the command
    // keys in one consistent place (hover to peek, click to pin).
    this.hintPanel = new HintPanel(this, { keys: "Space / Enter = advance · 1–9 = abilities · T = danger zone" });
    this.threatGfx = this.add.graphics().setDepth(0.36);
    this.preview = this.add.graphics().setDepth(0.4);
    this.highlight = this.add.graphics().setDepth(0.5);
    // A downward chevron that hovers over the acting unit (the active-unit cue).
    this.activeMarker = this.add
      .triangle(0, 0, -8, -10, 8, -10, 0, 2, COLOR.ally)
      .setStrokeStyle(1.5, COLOR.allyEdge)
      .setDepth(2)
      .setVisible(false);
    this.primary = new Button(this, this.scale.width / 2, this.scale.height - 26, { text: "", w: 220, h: 32, fill: COLOR.successDeep, stroke: COLOR.success, onClick: () => this.onPrimary() });
    this.add.existing(this.primary).setDepth(12);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.setupKeyboard();
    this.nextBeat();
  }

  /** Keyboard control (D44 playtest QoL): Space/Enter = primary, 1–9 = actions. */
  private setupKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    // Stop Space/Enter/digits from scrolling or otherwise leaking to the page.
    kb.addCapture("SPACE,ENTER,ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE");
    kb.on("keydown", (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        if (this.primary.visible) this.onPrimary();
        return;
      }
      if (e.code === "KeyT") {
        // Toggle the danger-zone overlay (every tile an enemy could hit this turn).
        this.showThreat = !this.showThreat;
        this.drawPreview();
        return;
      }
      const n = Number(e.key);
      const actions = this.commandPanel?.actions ?? [];
      if (Number.isInteger(n) && n >= 1 && n <= actions.length) {
        actions[n - 1]();
      }
    });
  }

  // --- Beat dispatch ---------------------------------------------------------

  private nextBeat(): void {
    this.clearBoard();
    this.clearButtons();
    this.clearOverlay();
    this.hideBattleHud();
    const beat = this.runner.currentBeat();
    if (!beat || this.runner.outcome) return this.showEnd();
    if (beat.kind === "provision") this.showProvision();
    else if (beat.kind === "rest") this.showRest();
    else this.startEncounter();
  }

  // --- Beat 1: Provision -----------------------------------------------------

  private showProvision(): void {
    const beat = this.runner.currentBeat();
    if (beat?.kind !== "provision") return;
    this.runner.provision([]); // initialize inventory + gold at the cap
    this.titleText.setText("Provision — The Hollow Mill");
    this.subText.setText(beat.intel ?? "");
    this.setHint("Load herbs under the storage cap, then March Out. Salve=+heal · Stimulant=+speed · Antidote=cleanse.");
    this.refreshProvisionButtons();
    this.setPrimary("March Out →");
  }

  private refreshProvisionButtons(): void {
    const beat = this.runner.currentBeat();
    if (beat?.kind !== "provision") return;
    const inv = this.runner.inventory;
    const specs = beat.offer.map((id) => ({
      text: `+ ${id} (have ${countOf(inv, id)})`,
      description: `Load one ${id} (uses storage).`,
      onClick: () => {
        if (addItem(inv, id, 1)) this.refreshProvisionButtons();
        else this.setHint("Storage full — that's the provisioning choice (can't carry everything).");
        this.refreshProvisionStatus();
      },
    }));
    this.layoutButtons(specs);
    this.refreshProvisionStatus();
  }

  private refreshProvisionStatus(): void {
    const inv = this.runner.inventory;
    this.subText.setText(`Storage ${slotsUsed(inv)}/${inv.storageCap}  ·  Gold ${this.runner.gold}`);
  }

  // --- Beat 3: Rest + Level-up + deserter choice -----------------------------

  private showRest(): void {
    this.titleText.setText("Rest in the Grain Loft");
    const before = new Map(this.runner.party.map((u) => [u.id, jobLevelOf(u, u.primaryJob)]));
    // Show the choice first; the level-up applies on the choice.
    this.setHint("The party recovers. A wounded bandit deserter begs for mercy — your call shapes the ambush ahead.");
    const beat = this.runner.currentBeat();
    const choiceMeta = beat?.kind === "rest" ? beat.choice : undefined;
    const apply = (choice: "spare" | "press") => {
      this.runner.rest(choice);
      const lines = this.runner.party.map((u) => {
        const was = before.get(u.id) ?? 1;
        const now = jobLevelOf(u, u.primaryJob);
        const unlocked = unlockedSkills(u, "battle").map((s) => s.name).join(", ");
        return `${u.name}: job L${was}→L${now}  ·  HP ${u.maxHp}  ·  actives: ${unlocked}`;
      });
      this.clearButtons();
      this.showOverlay(
        "Level Up!",
        `${this.runner.log[this.runner.log.length - 1]}\n\n${lines.join("\n")}`,
        true,
        560,
        220,
      );
      this.setPrimary("To the Chokepoint →");
    };
    this.layoutButtons([
      // Terse labels; the consequence each choice carries shows on hover (the
      // authored outcome summary) so it doesn't have to cram into the button.
      { text: choiceMeta?.spareLabel ?? "Spare", description: choiceMeta?.spare.summary ?? "Spare the deserter.", onClick: () => apply("spare") },
      { text: choiceMeta?.pressLabel ?? "Press", description: choiceMeta?.press.summary ?? "Press him for coin.", onClick: () => apply("press") },
    ]);
    this.setPrimary("", false);
  }

  // --- Encounters ------------------------------------------------------------

  private startEncounter(): void {
    const beat = this.runner.currentBeat();
    if (beat?.kind !== "encounter") return;
    this.staged = this.runner.stageEncounter(beat);
    this.staged.battle.seed();
    // Floating combat text rides the same bus the rules already emit on — so
    // damage/heal pop-ups cover every source (attacks, cleave, charged skills).
    this.busUnsubs.push(
      this.battle.bus.on("unitDamaged", ({ unit, amount, source }) => {
        // Note the blow so flashHit can scale the impact to it, then pop a
        // magnitude-emphasised damage number and narrate it in the log.
        this.view.noteDamage(unit.id, amount);
        this.view.floatDamage(unit, amount);
        this.view.logDamage(unit, amount, source);
      }),
      this.battle.bus.on("unitHealed", ({ unit, amount, source }) => {
        if (amount > 0) this.floatText(unit, `+${amount}`, INK.success);
        this.view.logHeal(unit, amount, source);
      }),
      this.battle.bus.on("unitDefeated", ({ unit }) => this.view.logDefeat(unit)),
      this.battle.bus.on("turnStart", ({ unit }) => this.view.logTurn(unit)),
    );
    this.ended = false;
    this.busy = false;
    this.waitingFor = null;
    this.armed = null;
    this.pendingHerb = null;
    this.titleText.setText(beat.encounter.name);
    // The header subtitle carries a live ally/foe tally (refreshHud) — storage and
    // gold aren't actionable mid-fight.
    this.rebuildBoard();
    this.refreshHud();
    // M5b — a deployment step opens each fight: reposition before the seed.
    this.enterDeploy();
  }

  // --- Deployment (M5b) ------------------------------------------------------

  /** Begin the pre-battle deployment step: pick a unit, reset the camp alert. */
  private enterDeploy(): void {
    this.deploying = true;
    this.waitingFor = null;
    this.armed = null;
    this.deployAlert = createAlert();
    this.deployRng = streamFor(this.staged!.encounter.id, "deploy");
    this.deployActor = this.battle.units.find((u) => u.side === "player" && !u.captured) ?? null;
    this.refreshDeploy();
    this.setPrimary("Start Battle →");
  }

  private refreshDeploy(): void {
    this.refreshHud(); // keep the CT order current (captured units drop); we override its subtitle below
    this.drawDeployZone(this.deployActor);
    this.highlightTile(this.deployActor?.pos ?? null);
    this.setActiveUnit(this.deployActor);
    const others = this.battle.units.filter((u) => u.side === "player" && !u.captured).length > 1;
    this.layoutButtons(others ? [{ text: "Next Unit", description: "Switch which unit you're positioning.", onClick: () => this.cycleDeploy() }] : []);
    const u = this.deployActor;
    if (!u) {
      this.subText.setText("Deployment — everyone's in. Start Battle.");
      this.setHint("Press Start Battle to begin.");
      return;
    }
    const past = Math.max(0, u.pos.col - safeDepth(u));
    this.subText.setText(`Deploy ${u.name}  ·  camp alert ${this.deployAlert.meter}%  ·  ${past > 0 ? `${past} past safe` : "in cover"}`);
    this.setHint(`${u.name}: reposition. Pushing past the green safe zone raises the camp's alert — get spotted and they bolt for cover, risking a net on the way. Start Battle when set.`);
  }

  /** Tint the safe-depth tiles (silent deployment) for the chosen unit. */
  private drawDeployZone(unit: Unit | null): void {
    this.view.clearPreview(this.preview);
    if (!unit) return;
    const maxCol = safeDepth(unit);
    for (let row = 0; row < this.battle.grid.rows; row++) {
      for (let col = 0; col <= maxCol && col < this.battle.grid.cols; col++) {
        if (this.battle.grid.isWalkable({ col, row })) this.fillTile(this.preview, { col, row }, COLOR.successDeep, 0.22);
      }
    }
  }

  private cycleDeploy(): void {
    if (this.busy) return;
    const players = this.battle.units.filter((u) => u.side === "player" && !u.captured);
    if (players.length === 0) return;
    const i = this.deployActor ? players.indexOf(this.deployActor) : -1;
    this.deployActor = players[(i + 1) % players.length];
    this.refreshDeploy();
  }

  private onDeployClick(tile: GridCoord): void {
    if (this.busy) return;
    // Click a (deployable) party member to select it.
    const clicked = this.battle.units.find((u) => u.alive && !u.captured && u.pos.col === tile.col && u.pos.row === tile.row);
    if (clicked && clicked.side === "player") {
      this.deployActor = clicked;
      return this.refreshDeploy();
    }
    const actor = this.deployActor;
    if (!actor || actor.captured) return;
    if (!this.battle.grid.isWalkable(tile)) return this.setHint("Can't deploy onto that tile.");
    const nav = occupiedGrid(this.battle.grid, this.battle.units, [actor]);
    const path = findPath(nav, actor.pos, tile);
    if (!path || path.length < 2) return this.setHint("No deploy path there.");
    const steps = path.slice(1).slice(0, effectiveMove(actor));
    actor.pos = { ...steps[steps.length - 1] };
    this.busy = true;
    this.animateMove(actor, steps, () => {
      this.busy = false;
      this.placeView(actor);
      this.resolveDeploy(actor);
    });
  }

  /** Resolve a deploy move via the shared core model, then play out the result. */
  private resolveDeploy(actor: Unit): void {
    const outcome = resolveDeployAction(this.deployAlert, actor, this.battle.grid, this.battle.units, this.deployRng);
    if (outcome.spotted) this.playRetreat(actor, outcome);
    else this.refreshDeploy();
  }

  /** Animate a spotted unit bolting for cover along the resolver's planned path. */
  private playRetreat(unit: Unit, outcome: DeployOutcome): void {
    this.floatText(unit, "SPOTTED!", INK.gold, -22);
    if (outcome.retreatPath.length === 0) return this.refreshDeploy(); // nowhere to fall back
    this.setHint(`${unit.name} was spotted — bolting for cover!`);
    this.walkRetreat(unit, outcome.retreatPath, outcome.capturedAt, 0);
  }

  /** Step the retreat one tile at a time; net the unit at the planned capture index. */
  private walkRetreat(unit: Unit, path: readonly GridCoord[], capturedAt: number, i: number): void {
    if (i >= path.length) {
      this.busy = false;
      this.refreshDeploy(); // refreshDeploy resets the hint, so set the outcome line after it
      this.setHint(`${unit.name} slipped back into cover — camp alert eased to ${this.deployAlert.meter}%.`);
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

  /** Netted mid-retreat: drop the net, bind the unit in the enemy corner. */
  private netCapture(unit: Unit): void {
    captureUnit(unit);
    this.dropNet(unit);
    this.floatText(unit, "NETTED!", INK.ember, -22);
    unit.pos = { col: this.battle.grid.cols - 1, row: this.battle.grid.rows - 1 };
    this.placeView(unit);
    this.refreshHp();
    this.busy = false;
    this.deployActor = this.battle.units.find((u) => u.side === "player" && !u.captured) ?? null;
    this.refreshDeploy();
    this.setHint(`${unit.name} was netted mid-retreat — bound for this fight, back with you next encounter.`);
  }

  /** Drop the capture-net cage on a unit's tile (shared deploy FX). */
  private dropNet(unit: Unit): void {
    const { x, y } = this.tileToWorld(unit.pos);
    this.boardObjects.push(dropNetCage(this, x, y - TILE_HEIGHT / 2, this.reduceMotion));
  }

  /** Commit the deployment and start combat: re-seed initiative on the final board. */
  private startBattle(): void {
    this.deploying = false;
    this.deployActor = null;
    this.view.clearPreview(this.preview);
    this.clearButtons();
    this.setActiveUnit(null);
    this.highlightTile(null);
    this.battle.seed(); // positions + captures are final — seed initiative now
    this.refreshHud();
    this.setPrimary("Advance Clock");
    this.setHint("Battle: press Advance Clock. Flank isolated foes, tarpit with Edrin, cleanse snares with Sela's antidote.");
  }

  private get battle() {
    return this.staged!.battle;
  }

  private onAdvance(): void {
    if (this.ended || this.busy || this.waitingFor) return;
    if (this.checkEncounterEnd()) return;
    const actor = this.battle.nextActor();
    if (!actor) return this.finishEncounter();
    if (this.checkEncounterEnd()) return; // the clock tick may have cut the bridge
    this.revealScouted();
    this.refreshHud();
    // A hidden ambush body lies in wait — the AI doesn't act on it until the
    // party scouts it into view (D42/D44 fog). It just waits its turn.
    if (actor.hidden) {
      this.battle.endTurn(actor, {});
      this.setHint("Something stirs in ambush ahead… scout it out.");
      return;
    }
    this.highlightTile(actor.pos);
    this.setActiveUnit(actor);
    if (actor.side === "enemy") {
      this.busy = true;
      this.setHint(`${actor.name} (enemy) acts…`);
      const plan = this.battle.runEnemyTurn(actor);
      this.animateMove(actor, plan.path, () => {
        if (plan.target) this.flash(actor, plan.target);
        this.afterTurn();
      });
    } else {
      this.waitingFor = actor;
      this.setHint(`${actor.name}'s turn — click to move/attack, or use a kit ability.`);
      this.showKitButtons(actor);
    }
  }

  private showKitButtons(actor: Unit): void {
    const specs: { text: string; description?: string; onClick: () => void }[] = [];
    for (const skill of unlockedSkills(actor, "battle")) {
      const cooling = !this.battle.canUseSkill(actor, skill);
      const cd = actor.cooldowns[skill.id];
      const charge = skill.cost?.charge ? " (charge)" : "";
      const tag = cooling ? ` [cd ${Math.ceil(cd ?? 0)}]` : charge;
      specs.push({
        text: `${skill.name}${tag}`,
        description: `${skill.name} — ${skill.description}`,
        onClick: () => {
          if (cooling) return this.setHint(`${skill.name} is cooling down.`);
          this.onKitButton(actor, skill);
        },
      });
    }
    specs.push({ text: "Defend", description: DEFEND.description, onClick: () => this.commitSkill(actor, DEFEND, actor) });
    this.layoutButtons(specs);
    this.drawPreview();
  }

  private onKitButton(actor: Unit, skill: SkillDef): void {
    if (this.busy || this.waitingFor !== actor) return;
    if (skill.effect.kind === "med-heal") {
      // Pick a herb, then a target ally.
      const inv = this.runner.inventory;
      const herbs = ["salve", "stimulant", "antidote"].filter((h) => countOf(inv, h) > 0);
      if (herbs.length === 0) return this.setHint("No herbs carried — provision some next run.");
      this.layoutButtons(
        herbs.map((h) => ({
          text: `${h} (${countOf(inv, h)})`,
          description: `Heal with ${h}.`,
          onClick: () => {
            this.pendingHerb = h;
            this.armed = skill;
            this.setHint(`Heal (${h}): click a wounded ally.`);
            this.drawPreview();
          },
        })),
      );
      return;
    }
    if (skill.target === "self") return this.commitSkill(actor, skill, actor);
    this.armed = skill;
    this.setHint(`${skill.name}: click a target (or click ${actor.name} to cancel).`);
    this.drawPreview();
  }

  private commitSkill(actor: Unit, skill: SkillDef, target: Unit): void {
    this.armed = null;
    this.waitingFor = null;
    this.busy = true;
    this.clearButtons();
    this.highlightTile(null);
    let verb = "acts";
    if (skill.effect.kind === "med-heal" && this.pendingHerb) {
      const out = this.battle.useHeal(actor, skill, target, this.pendingHerb, this.runner.inventory);
      this.pendingHerb = null;
      verb = out.cleansed ? `cleanses ${out.cleansed}` : out.healed ? `heals ${out.healed}` : "no herb";
      if (out.cleansed) this.floatText(target, `cleanse ${out.cleansed}`, INK.cyan);
      this.flash(actor, target);
    } else if (skill.effect.kind === "cleave") {
      const dir = { col: Math.sign(target.pos.col - actor.pos.col) || 1, row: target.pos.col === actor.pos.col ? Math.sign(target.pos.row - actor.pos.row) : 0 };
      const res = this.battle.cleave(actor, skill, dir);
      verb = `cleaves ${res.hits} foe(s) for ${res.damage}`;
      this.flash(actor, target);
    } else {
      const out = this.battle.useSkill(actor, skill, target);
      verb = out.charging ? "begins charging" : out.damage ? `hits for ${out.damage}` : out.healed ? `heals ${out.healed}` : out.status ? `applies ${out.status}` : "acts";
      this.flash(actor, target);
    }
    this.afterTurn();
    if (!this.ended) this.setHint(`${actor.name} — ${skill.name}: ${verb}. Advance Clock.`);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.staged) return;
    const tile = this.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.battle.grid.inBounds(tile)) return;
    if (this.deploying) return this.onDeployClick(tile);
    const actor = this.waitingFor;
    if (this.ended || this.busy || !actor) return;
    const clicked = this.battle.units.find((u) => u.alive && !u.hidden && u.pos.col === tile.col && u.pos.row === tile.row);

    if (this.armed) {
      if (clicked === actor) {
        this.armed = null;
        this.pendingHerb = null;
        this.setHint(`${actor.name}'s turn.`);
        this.showKitButtons(actor);
        return;
      }
      if (clicked && isValidSkillTarget(this.armed, actor, clicked)) return this.commitSkill(actor, this.armed, clicked);
      return this.setHint("Not a valid target for that ability.");
    }

    if (clicked && clicked.side !== actor.side) return this.playerAttack(actor, clicked);
    if (!clicked && this.battle.grid.isWalkable(tile)) return this.playerMove(actor, tile);
  }

  private playerAttack(actor: Unit, foe: Unit): void {
    const plan = planAttack(actor, foe, this.battle.units, this.battle.grid);
    if (!plan) return this.setHint("No path to that foe.");
    this.commitMove(actor, plan.path, plan.attackTarget);
  }

  private playerMove(actor: Unit, tile: GridCoord): void {
    const path = planMove(actor, tile, this.battle.units, this.battle.grid);
    if (!path) return this.setHint("Can't move there.");
    this.commitMove(actor, path, null);
  }

  private commitMove(actor: Unit, path: GridCoord[], target: Unit | null): void {
    this.armed = null;
    this.waitingFor = null;
    this.busy = true;
    this.clearButtons();
    this.highlightTile(null);
    if (path.length > 0) this.battle.moveUnit(actor, path);
    if (target && target.alive) {
      // Flank is computed from the post-move position, so a "FLANK!" cue fires
      // exactly when the +bonus actually lands.
      const flanked = computeFlankBonus(actor, target, this.battle.units) > 0;
      this.battle.attack(actor, target);
      if (flanked) this.floatText(target, "FLANK!", INK.gold, -14);
    }
    this.battle.endTurn(actor, { moved: path.length > 0, acted: target !== null });
    this.animateMove(actor, path, () => {
      if (target) this.flash(actor, target);
      this.afterTurn();
    });
  }

  private afterTurn(): void {
    this.busy = false;
    this.revealScouted();
    this.refreshHud();
    this.highlightTile(null);
    this.setActiveUnit(null);
    if (this.checkEncounterEnd()) return;
    this.setHint("Press Advance Clock for the next turn.");
  }

  /** Reveal hidden ambush bodies the party can now see (the scouting payoff). */
  private revealScouted(): void {
    if (!this.staged) return;
    for (const u of this.battle.units) {
      if (u.hidden && u.alive && canSee(this.battle.units, "player", u.pos)) {
        u.hidden = false;
        this.setHint(`Ambush revealed — ${u.name} springs from cover!`);
      }
    }
  }

  /** True (and finishes) if the encounter has reached a graded terminal (D43). */
  private checkEncounterEnd(): boolean {
    if (!this.staged || this.ended) return this.ended;
    if (this.staged.objective.failed) {
      this.finishEncounter("objective-failure");
      return true;
    }
    const o = this.battle.outcome();
    if (o.over) {
      this.finishEncounter(o.winner === "player" ? "win" : "wipe");
      return true;
    }
    return false;
  }

  private finishEncounter(forced?: EncounterResult): void {
    if (this.ended) return;
    this.ended = true;
    this.clearButtons();
    this.highlightTile(null);
    const result: EncounterResult =
      forced ?? (this.staged!.objective.failed ? "objective-failure" : this.battle.outcome().winner === "player" ? "win" : "wipe");
    this.runner.resolveEncounter(this.staged!, result);
    const titles: Record<EncounterResult, string> = { win: "Victory", "objective-failure": "Objective Failed — Retreat", wipe: "Party Wiped" };
    const body =
      result === "win"
        ? "The field is yours. Press on."
        : result === "objective-failure"
          ? "The bridge fell and the Captain slipped away — but the party retreats ALIVE (a graded failure, not a wipe)."
          : "Every fighter is down. The run is over.";
    this.showOverlay(titles[result], body, result !== "wipe");
    this.setPrimary(result === "wipe" ? "End" : "Continue →");
  }

  // --- Primary button --------------------------------------------------------

  private onPrimary(): void {
    const beat = this.runner.currentBeat();
    if (this.runner.outcome) {
      this.scene.start("GuildScene");
      return;
    }
    if (!beat) return this.showEnd();
    if (beat.kind === "encounter") {
      if (this.deploying) return this.startBattle();
      if (this.ended) {
        this.runner.advance();
        return this.nextBeat();
      }
      return this.onAdvance();
    }
    // provision / rest: advance the beat.
    this.runner.advance();
    this.nextBeat();
  }

  /** Tear down the in-battle HUD header — turn order, the bridge timer, and the
   *  ally/foe tally — so non-battle screens (rest) and the end overlay don't
   *  inherit stale battle chrome at the top. */
  private hideBattleHud(): void {
    this.subText.setText("");
    this.timerText.setText("");
    this.orderText.setText("");
    this.view.hideInitiative();
  }

  private showEnd(): void {
    this.clearBoard();
    this.clearButtons();
    this.hideBattleHud();
    const o = this.runner.outcome ?? "complete";
    const title = o === "complete" ? "The Hollow Mill is Cleared!" : o === "failed" ? "Quest Failed — the Party Survives" : "Party Wiped";
    // A payoff line so a win lands: who made it back, the purse, and a star rating
    // (all five home = ★★★, one down = ★★, bloodier = ★; a graded failure earns ★).
    const survived = this.runner.party.filter((u) => u.alive).length;
    const total = this.runner.party.length;
    const stars = o === "wipe" ? "" : o === "failed" ? "★" : survived === total ? "★★★" : survived >= total - 1 ? "★★" : "★";
    const tally = `${survived}/${total} marched home   ·   ${this.runner.gold}g purse${stars ? `   ·   ${stars}` : ""}`;
    this.titleText.setText("");
    this.showOverlay(title, `${tally}\n\n${this.runner.log.slice(-6).join("\n")}`, o !== "wipe", 620, 270);
    this.setHint(o === "wipe" ? "The run is over — back to the guild to rebuild." : "Return to the guild to bank the survivors and loot.");
    this.runner.outcome = o; // ensure onPrimary routes back to the guild
    this.setPrimary("Back to Guild");
  }

  // --- Board rendering -------------------------------------------------------

  private rebuildBoard(): void {
    this.clearBoard();
    const grid = this.battle.grid;
    // Center the board in the band *left* of the right-hand command panel so its
    // far-right tiles never hide behind the action buttons.
    this.originX = (this.scale.width - this.panelMaxW - 24) / 2;
    this.originY = this.scale.height / 2 - (grid.rows * TILE_HEIGHT) / 2 + 10;
    this.view.setOrigin(this.originX, this.originY);
    this.drawGrid();
    for (const unit of this.battle.units) this.spawnUnit(unit);
    this.refreshHp();
  }

  private clearBoard(): void {
    for (const u of this.busUnsubs) u();
    this.busUnsubs = [];
    this.view.clearUnits();
    for (const o of this.boardObjects) o.destroy();
    this.boardObjects = [];
    this.deploying = false;
    this.deployActor = null;
    this.gridGfx?.destroy();
    this.gridGfx = undefined;
    this.highlight.clear();
    this.view.clearPreview(this.preview);
    this.threatGfx?.clear();
    this.setActiveMarker(null);
  }

  private drawGrid(): void {
    const g = this.add.graphics();
    this.gridGfx = g;
    this.view.drawGrid(g, this.battle.grid);
  }

  private spawnUnit(unit: Unit): void {
    this.view.spawnUnit(unit);
  }

  /** Mark the unit taking its turn; its nameplate stays up until the turn ends. */
  private setActiveUnit(unit: Unit | null): void {
    this.view.setActiveUnit(unit);
  }

  private placeView(unit: Unit): void {
    this.view.placeView(unit);
  }

  private refreshHp(): void {
    this.view.refreshUnits();
  }

  private refreshHud(): void {
    const live = [...this.battle.units].filter((u) => u.alive && !u.captured && !u.hidden);
    // Live ally/foe tally in the header — actionable battle state, unlike storage/gold.
    const allies = live.filter((u) => u.side === "player").length;
    const foes = live.filter((u) => u.side === "enemy").length;
    this.subText.setText(`Allies ${allies}  ·  Foes ${foes}`);
    // The visual initiative rail (shared CombatView): one chip per unit sorted by
    // charge time, the acting unit lit, fallen trailing dimmed. Replaces the old
    // monospace "CT order" list — `orderText` is now just its header.
    this.orderText.setText("Turn order");
    this.view.drawInitiative(this.battle.units, 8, 86, (u) => this.battle.clock.isCharging(u));
    this.refreshHp();
    // The bridge-cut timer (D43): a visible race readout.
    const prog = this.battle.clock.scheduledProgress(`objective:${this.staged?.encounter.id}:bridge-cut`);
    if (prog !== undefined) {
      const pct = Math.round(prog * 100);
      this.timerText.setText(`⚠ BRIDGE CUT ${pct}% — kill or Immobilize the Sapper!`);
    } else if (this.staged?.encounter.objective && !this.staged.objective.failed) {
      this.timerText.setText("Bridge secured — the Sapper is down.");
    }
  }

  // --- Geometry --------------------------------------------------------------

  private tileToWorld(coord: GridCoord): { x: number; y: number } {
    return this.view.tileToWorld(coord);
  }

  private worldToTile(px: number, py: number): GridCoord {
    return this.view.worldToTile(px, py);
  }

  private highlightTile(coord: GridCoord | null): void {
    this.view.highlightTile(this.highlight, coord);
    this.setActiveMarker(coord);
    if (!coord) this.view.clearPreview(this.preview);
  }

  /** Hover the bobbing active-unit chevron over a tile (or hide it on null). */
  private setActiveMarker(coord: GridCoord | null): void {
    this.tweens.killTweensOf(this.activeMarker);
    if (!coord) return void this.activeMarker.setVisible(false);
    const { x, y } = this.tileToWorld(coord);
    // Clears the active unit's nameplate (name sits at cy − 36).
    const baseY = y - TILE_HEIGHT / 2 - 48;
    this.activeMarker.setPosition(x, baseY).setVisible(true);
    // The perpetual bob is the one animation that never "settles"; skip it under
    // the screenshot harness so captures are deterministic (chevron sits static).
    if (this.reduceMotion) return;
    this.tweens.add({ targets: this.activeMarker, y: baseY - 6, duration: 480, yoyo: true, repeat: -1, ease: "Sine.InOut" });
  }

  /**
   * True when no transient animation is in flight — the screenshot harness polls
   * this as an idle sync point so frames aren't captured mid-tween. (Only
   * meaningful under reduceMotion, which suppresses the perpetual chevron bob.)
   */
  isSettled(): boolean {
    return !this.busy && this.view.floaters.size === 0 && this.tweens.getTweens().length === 0;
  }

  /**
   * Paint the player's options on their turn (the "don't click blind" preview):
   * with an ability armed, tint its **valid targets**; otherwise tint the
   * **reachable** move tiles and outline the **foes in reach** this turn.
   */
  private drawPreview(): void {
    const actor = this.waitingFor;
    if (!actor || this.busy || this.ended) {
      this.view.clearPreview(this.preview);
      this.threatGfx.clear();
      return;
    }
    if (this.showThreat) this.view.drawThreatZone(this.threatGfx, this.battle.units, this.battle.grid, "player");
    else this.threatGfx.clear();
    this.view.drawPreview(this.preview, actor, this.battle.units, this.battle.grid, this.armed ?? undefined);
  }

  private fillTile(g: Phaser.GameObjects.Graphics, coord: GridCoord, fill: number, alpha: number, line?: number): void {
    this.view.fillTile(g, coord, fill, alpha, line);
  }

  /** A short-lived combat-text pop-up that drifts up off a unit and fades. */
  private floatText(unit: Unit, text: string, color: string, dy = 0): void {
    this.view.floatText(unit, text, color, dy);
  }

  // --- Animation -------------------------------------------------------------

  private animateMove(unit: Unit, path: readonly GridCoord[], done: () => void): void {
    this.view.animateMove(unit, path, done);
  }

  private flash(attacker: Unit, target: Unit): void {
    this.view.flashHit(attacker, target);
  }

  // --- UI primitives ---------------------------------------------------------

  private setPrimary(text: string, visible = true): void {
    this.primary.setLabel(text).setVisible(visible);
  }

  private clearButtons(): void {
    this.commandPanel?.destroy();
    this.commandPanel = undefined;
    // A button hovered at teardown never fires pointer-out; drop any stuck tip.
    this.hintPanel.clearTip();
  }

  /**
   * Build (or rebuild) the right-hand command panel. A {@link ButtonColumn} sizes
   * itself to its widest label — growing leftward into the gap beside the board,
   * never past the reserved `panelMaxW` band — so labels render at full size
   * instead of being shrunk to fit. The number-key hotkeys (1–9) ride on the
   * labels and are exposed via the panel's `actions`.
   */
  private layoutButtons(specs: { text: string; description?: string; onClick: () => void }[]): void {
    this.clearButtons();
    if (specs.length === 0) return;
    this.commandPanel = new ButtonColumn(this, {
      specs,
      rightEdge: this.scale.width - 12,
      centerY: this.scale.height / 2 - 20,
      minW: this.panelMinW,
      maxW: this.panelMaxW,
      hintBar: this.hintPanel,
      idleHint: () => this.lastHint,
    });
  }

  private setHint(text: string): void {
    this.lastHint = text;
    this.hintPanel.setResting(text);
  }

  private clearOverlay(): void {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
  }

  private showOverlay(title: string, body: string, good: boolean, w = 480, h = 180): void {
    this.clearOverlay();
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.94).setStrokeStyle(2, good ? COLOR.success : COLOR.danger).setDepth(20),
      this.add.text(cx, cy - h / 2 + 26, title, { color: good ? INK.success : INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(cx, cy + 12, body, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label, align: "center", lineSpacing: 4, wordWrap: { width: w - 40 } }).setOrigin(0.5).setDepth(21),
    );
  }
}
