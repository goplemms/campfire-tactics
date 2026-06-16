/**
 * Run-loop orchestrator (M6) — the single entry the render layer drives.
 *
 * Steps a seeded run through the phase pipeline Camp → Deployment → Battle →
 * Resolution → next, applying Upkeep/recovery (D9/D15), rewards, material
 * recovery (D13), auto-rescue (D21) and the mortality policy (D9) between
 * encounters, until {@link RunLoop.isOver}. The orchestrator owns the *wiring*;
 * each rule still lives in its own core module — it just sequences them and
 * threads the run's single RNG so the whole run is deterministic.
 *
 * Pure logic: no Phaser, no DOM. Headlessly testable: {@link RunLoop.autoBattle}
 * plays a battle to a decision deterministically so a test can run a full run to
 * a wipe and replay a seed.
 */

import type { Unit } from "./units";
import type { GridCoord } from "./iso";
import { TileGrid } from "./grid";
import { Battle } from "./turn";
import { buildGrid, buildEnemies, type EncounterDef } from "./generation";
import {
  type RunState,
  runDifficulty,
  currentNode,
  currentEncounter,
  combatRoster,
  isRunOver,
  removeFromRoster,
  recordNight,
  reachableNodes,
  chooseNode,
  breakCamp,
} from "./run";
import type { MapNode } from "./overworld";
import { moraleModifiers } from "./morale";
import { moraleTier } from "./camp";
import { applyCampToParty } from "./camp";
import { freeCaptive } from "./deployment";
import { recoverMaterials } from "./resolution";
import { addItem } from "./inventory";
import { resolveDowned, resolveCaptured, tickDyingClocks, type DownedOutcome, type RescueQuest } from "./mortality";
import { rpPerNight, payUpkeep, triageHeal, computeUpkeep, RECOVERY, type UpkeepResult } from "./upkeep";
import { intelFloor, readEncounter, type IntelReport, type IntelTier } from "./intel";
import { planEnemyTurn } from "./ai";
import { restoreFatigue } from "./fatigue";
import { takeOverworldAction, type ActionOpts, type ActionResult } from "./overworld-actions";
import { gainRunGold } from "./economy";
import {
  eventForNode,
  resolveEvent,
  eventChoices,
  chooseEventOption,
  type EventDef,
  type EventOutcome,
  type EventChoice,
} from "./node-events";

/** What a resolved encounter produced (for the render/run-end screen). */
export interface ResolveResult {
  winner?: "player" | "enemy";
  goldEarned: number;
  recovered: string[];
  rescued: string[];
  downed: DownedOutcome[];
  permadeaths: string[];
  rescueQuests: RescueQuest[];
  over: boolean;
}

/** What the nightly camp step produced. */
export interface CampResult {
  upkeep: UpkeepResult;
  rpAdded: number;
  dyingLost: string[];
}

/** What a rest node's recovery produced (no battle, D23). */
export interface RestResult {
  upkeep: UpkeepResult;
  rpAdded: number;
  /** Units auto-triaged and the HP each gained. */
  healed: { unitId: string; hp: number }[];
  moraleGained: number;
  /** Units whose overworld fatigue was restored to Rested (D35 — rest's second job). */
  fatigueRestored: string[];
  /** Accumulated worn-gear debt the premium rest cleared in one swipe (D47). */
  debtCleared: number;
  dyingLost: string[];
  over: boolean;
}

/** What an {@link RunLoop.inPlaceRest} produced (D47 — the lesser, repeatable tier). */
export interface InPlaceRestResult {
  /** False if the rest was refused (party already full, or can't afford a night). */
  applied: boolean;
  /** When refused: why (render-facing). */
  reason?: string;
  /** Gold paid for the night's upkeep (0 when refused). */
  goldSpent: number;
  /** Rest Points banked this night — the per-night rate cap. */
  rpAdded: number;
  /** Units healed and the HP each gained. */
  healed: { unitId: string; hp: number }[];
  /** Total HP restored — ≥1 on an applied rest (the floor, D47); 0 only on a refusal. */
  hpHealed: number;
}

/**
 * What an **event** node produced (no battle, M11) — the chosen/auto-resolved
 * {@link EventDef} plus its structured {@link EventOutcome} and the run terminal.
 */
export interface EventResolution {
  /** The event that fired at this node (deterministic for a seed, D22). */
  def: EventDef;
  /** The structured outcome (already applied to the run). */
  outcome: EventOutcome;
  over: boolean;
}

/** Rest-node tuning — the recovery a no-battle camp grants (data, D23). */
export const REST = {
  /**
   * Healing chunks a restful night funds, in addition to the nightly Rest
   * Points. Denominated in **chunks** (each costs `policy.rpPerChunk` RP) so a
   * rest is meaningful at every difficulty — the dying-clock dial scales with it.
   */
  chunks: 3,
  /** Morale a good rest restores (D8). */
  moraleGain: 2,
} as const;

/** The run-loop orchestrator. */
export class RunLoop {
  readonly run: RunState;
  /** The encounter currently being played (set by {@link startEncounter}). */
  encounter?: EncounterDef;
  /** The live battle for the current encounter. */
  battle?: Battle;
  /** Player combatants placed for the current encounter. */
  combatants: Unit[] = [];

  constructor(run: RunState) {
    this.run = run;
  }

  /** True once the run has ended (a wipe, or a lost battle). */
  isOver(): boolean {
    return this.run.over;
  }

  /** True once the run has been completed (the final node cleared, D23). */
  isComplete(): boolean {
    return this.run.complete;
  }

  /** True once the run has reached any terminal (over or complete). */
  isTerminal(): boolean {
    return this.run.over || this.run.complete;
  }

  // --- Overworld (D22) ------------------------------------------------------

  /** The branch choices reachable from the run's current map position (D22). */
  reachable(): MapNode[] {
    return reachableNodes(this.run);
  }

  /** Commit to a reachable node — moves the run there so it can be played (D22). */
  choose(id: string): MapNode {
    return chooseNode(this.run, id);
  }

  // --- The unified overworld camp (D35) -------------------------------------

  /**
   * Take an overworld action at the current node (D29/D35) — the unified camp's
   * verb. Delegates to the cost-gating interpreter ({@link takeOverworldAction}):
   * checks the ability is off cooldown and the actor has fatigue headroom/gold,
   * applies the effect, spends the costs and arms the node-step cooldown. Never
   * throws on a refusal — returns the {@link ActionResult} the render reads.
   */
  overworldAction(unit: Unit, abilityId: string, opts: ActionOpts = {}): ActionResult {
    return takeOverworldAction(this.run, unit, abilityId, opts);
  }

  // --- Rest node (no battle, D23) -------------------------------------------

  /**
   * Play a **rest** node: a night of recovery with **no fight** (D23). Pays
   * Upkeep (a night still costs), banks the nightly Rest Points **plus a rest
   * bonus**, **auto-triages** the most-wounded fighters down the RP pool, nudges
   * morale up (D8), **restores every member's overworld fatigue** (rest's second
   * job, D29/D35), ticks any dying clocks, and records the night. Returns a
   * summary for the render's rest screen.
   */
  restNode(): RestResult {
    const policy = runDifficulty(this.run);
    // The premium tier pays a full night (no voluntary skips) — it clears debt, it
    // doesn't add to it (D47).
    const upkeep = payUpkeep(this.run.camp, this.run.party, { skip: [] });
    const rpAdded = rpPerNight(this.run.party) + REST.chunks * policy.rpPerChunk;
    this.run.rp += rpAdded;

    // Rest's second job (D35): wipe overworld fatigue clean — the only restore.
    const fatigueRestored: string[] = [];
    for (const u of this.run.party) {
      if (u.fatigue > 0) {
        u.fatigue = restoreFatigue(u.fatigue);
        fatigueRestored.push(u.id);
      }
    }

    // Auto-triage: heal the worst-off fighters first, spending the RP pool down.
    const healed: { unitId: string; hp: number }[] = [];
    const wounded = combatRoster(this.run)
      .filter((u) => u.hp < u.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    for (const u of wounded) {
      if (this.run.rp < policy.rpPerChunk) break;
      const res = triageHeal(u, this.run.rp, policy);
      if (res.rpSpent > 0) {
        this.run.rp -= res.rpSpent;
        healed.push({ unitId: u.id, hp: res.hpHealed });
      }
    }

    this.run.camp.morale += REST.moraleGain;

    // Premium tier (D47): clear accumulated Upkeep debt (hunger / worn gear from
    // voluntary underfunding) in one swipe — what in-place rest does *not* do.
    const debtCleared = this.run.camp.gearWear;
    this.run.camp.gearWear = 0;
    this.run.camp.skippedUpkeep = [];

    const lost = tickDyingClocks(this.run.party);
    for (const u of lost) removeFromRoster(this.run, u);
    const node = currentNode(this.run);
    const over = recordNight(this.run, {
      nodeId: node.id,
      layer: node.layer,
      kind: node.kind,
      goldEarned: 0,
      fallen: lost.map((u) => u.id),
    });
    return { upkeep, rpAdded, healed, moraleGained: REST.moraleGain, fatigueRestored, debtCleared, dyingLost: lost.map((u) => u.id), over };
  }

  /**
   * **In-place rest** (D47) — the lesser, repeatable recovery tier: a costed lever
   * at any *finished* node (the D46 Survey beat). Pays a night's Upkeep → banks the
   * night's Rest Points (support classes boost it via `rpPerNight` — *that is* the
   * class boost, already in the model) → a **small** triage heal of the
   * most-wounded, **floored at ≥1** so a paid rest never reads "healed 0" like a
   * bug. **Each rest is a full node-step**: it Breaks Camp (ticks cooldowns +
   * accrues interest, D35) and a night passes — a deliberate lever: *buy HP **and**
   * cooldown progress for a night's rations.*
   *
   * Two caps by design: **gold** (refuses, spending nothing, when the purse can't
   * afford another night) and the **per-night RP rate** (one night banks only so
   * much → rate-limited regardless of wealth → the rest node stays faster/better).
   * **Refuses** at full HP (no empty drain). Unlike the rest node, it does **not**
   * restore fatigue or clear worn-gear debt — those stay rest-node-only (D47).
   */
  inPlaceRest(): InPlaceRestResult {
    const policy = runDifficulty(this.run);
    const refuse = (reason: string): InPlaceRestResult => ({
      applied: false, reason, goldSpent: 0, rpAdded: 0, healed: [], hpHealed: 0,
    });

    // Refuse at full health (no empty drain, D47) — only wounded fighters count.
    const wounded = combatRoster(this.run)
      .filter((u) => u.hp < u.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    if (wounded.length === 0) return refuse("The party is already at full health.");

    // Gold cap (D47): refuse if the purse can't cover a full night's rations — no
    // breach, no morale teeth; the in-place rest only proceeds when fully funded.
    const bill = computeUpkeep(this.run.party);
    if (this.run.camp.gold < bill.total) {
      return refuse(`Not enough gold for a night's rations (${bill.total}g).`);
    }

    const upkeep = payUpkeep(this.run.camp, this.run.party, { skip: [] });
    const rpAdded = rpPerNight(this.run.party);
    this.run.rp += rpAdded;

    // Small heal: triage the single most-wounded down the pool, capped at a small
    // number of chunks (rate-limited by the night's RP), then floor it at ≥1.
    const healed: { unitId: string; hp: number }[] = [];
    let hpHealed = 0;
    const target = wounded[0];
    const budget = Math.min(this.run.rp, RECOVERY.inPlaceChunks * policy.rpPerChunk);
    if (budget >= policy.rpPerChunk) {
      const res = triageHeal(target, budget, policy);
      if (res.rpSpent > 0) {
        this.run.rp -= res.rpSpent;
        hpHealed = res.hpHealed;
      }
    }
    // Floor (D47): a paid rest on a wounded party always restores ≥1 HP.
    if (hpHealed < RECOVERY.inPlaceFloorHp) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + RECOVERY.inPlaceFloorHp);
      hpHealed += target.hp - before;
    }
    if (hpHealed > 0) healed.push({ unitId: target.id, hp: hpHealed });

    // Each rest is a full node-step (D47): Break Camp ticks the spine + accrues
    // interest, and a night passes — but the run stays at this node (repeatable).
    breakCamp(this.run);
    this.run.night += 1;
    return { applied: true, goldSpent: upkeep.paid, rpAdded, healed, hpHealed };
  }

  // --- Event node (the data-driven registry, no battle, M11) ----------------

  /** The event the current node runs — deterministic for a seed (M11, D22). */
  eventDef(): EventDef {
    return eventForNode(this.run.seed, currentNode(this.run));
  }

  /**
   * Play an **event** node **headlessly** (M11, D4/D22): resolve the node's event
   * through its {@link EventDef.autoResolve} (the deterministic default — a thief
   * skims, a shop/recruiter is passed, a story takes its seed-picked option), then
   * record the night/cooldown tick. This is the path {@link autoTraverse} and {@link
   * playCurrentNode} take; the interactive render uses {@link eventChoices}/{@link
   * chooseEvent}/{@link recordEventNight} instead.
   */
  eventNode(): EventResolution {
    const node = currentNode(this.run);
    const def = eventForNode(this.run.seed, node);
    const outcome = resolveEvent(this.run, node);
    const over = this.recordEventNight(outcome.goldDelta);
    return { def, outcome, over };
  }

  /** The interactive options for the current event node (M11) — render-facing. */
  eventChoices(): EventChoice[] {
    return eventChoices(this.run, currentNode(this.run));
  }

  /**
   * Apply one interactive event option (M11) — a shop buy, a recruiter Hire/Decline,
   * a story option. Does **not** record the night; the render calls {@link
   * recordEventNight} once the player is done interacting.
   */
  chooseEvent(choiceId: string): EventOutcome {
    return chooseEventOption(this.run, currentNode(this.run), choiceId);
  }

  /**
   * Record the event node's night/cooldown tick once the player has finished
   * interacting (M11). `goldEarned` is the net purse delta the render accumulated
   * (informational in the history). Returns the run terminal.
   */
  recordEventNight(goldEarned = 0): boolean {
    const node = currentNode(this.run);
    return recordNight(this.run, {
      nodeId: node.id,
      layer: node.layer,
      kind: node.kind,
      goldEarned,
      fallen: [],
    });
  }

  // --- Camp (between battles, D9/D15) ---------------------------------------

  /**
   * Run the nightly camp upkeep + recovery (D9/D15): pay Upkeep (underfunding a
   * line hits morale), bank Rest Points, and tick any Hard-mode dying clocks —
   * removing units whose clock ran out (permadeath). RP triage and cleric
   * revives are explicit player actions on {@link "./upkeep"}.
   */
  camp(): CampResult {
    const upkeep = payUpkeep(this.run.camp, this.run.party);
    const rpAdded = rpPerNight(this.run.party);
    this.run.rp += rpAdded;
    const lost = tickDyingClocks(this.run.party);
    const dyingLost = lost.map((u) => u.id);
    for (const u of lost) removeFromRoster(this.run, u);
    this.run.over = isRunOver(this.run);
    return { upkeep, rpAdded, dyingLost };
  }

  // --- Intel (D10) ----------------------------------------------------------

  /** The current encounter's intel report at the party's floor tier (D10). */
  intel(extraTier = 0): IntelReport {
    const def = this.encounter ?? currentEncounter(this.run);
    const tier = Math.min(3, intelFloor(this.run.party) + extraTier) as IntelTier;
    return readEncounter(def, tier);
  }

  // --- Battle setup ---------------------------------------------------------

  /**
   * Generate and stage the current encounter: build the grid, inflate enemies,
   * place the active roster on the home (left) edge, and create the {@link Battle}
   * the render drives. `deploymentPenalty` shrinks the player's usable home
   * columns (the D9 rescue "ambush-in-reverse" modifier).
   */
  startEncounter(deploymentPenalty = 0): Battle {
    const def = currentEncounter(this.run);
    this.encounter = def;
    const grid = buildGrid(def);
    const enemies = buildEnemies(def);
    const players = combatRoster(this.run);
    this.placePlayers(players, grid, def, deploymentPenalty);
    this.combatants = players;
    this.battle = new Battle(grid, [...players, ...enemies]);
    return this.battle;
  }

  /** Position player combatants on the left edge, resetting combat-scoped state. */
  private placePlayers(
    players: Unit[],
    grid: TileGrid,
    def: EncounterDef,
    deploymentPenalty: number,
  ): void {
    // The rescue modifier pushes the home edge inward (fewer columns to set up).
    const homeCols = Math.max(1, 2 - Math.min(1, deploymentPenalty));
    const taken = new Set<string>();
    for (const block of def.blocked) taken.add(`${block.col},${block.row}`);
    players.forEach((u, i) => {
      let pos: GridCoord = { col: i % homeCols, row: i % def.rows };
      for (let row = 0; row < def.rows; row++) {
        for (let col = 0; col < homeCols; col++) {
          const key = `${col},${row}`;
          if (!taken.has(key) && grid.isWalkable({ col, row })) {
            pos = { col, row };
            taken.add(key);
            row = def.rows;
            break;
          }
        }
      }
      taken.add(`${pos.col},${pos.row}`);
      u.pos = pos;
      u.ct = 0;
      u.statuses = [];
      u.captured = false;
    });
  }

  /**
   * Begin the staged battle: apply the Chef's banked heal and seed initiative
   * warmed by the current morale tier (D8). Returns the HP healed.
   */
  beginBattle(): number {
    if (!this.battle) throw new Error("RunLoop.beginBattle: no staged battle");
    const healed = applyCampToParty(this.run.camp, this.battle.units, this.battle.bus);
    const mods = moraleModifiers(moraleTier(this.run.camp.morale));
    this.battle.seed(mods.initiativeBonus);
    return healed;
  }

  // --- Resolution (D13/D21/D9) ----------------------------------------------

  /**
   * Resolve the finished battle: award gold (morale gold-find bonus, D8) and
   * material drops on a win, recover unsprung materials (D13), auto-rescue still-
   * captured allies (D21), apply the mortality policy to downed units (D9) with
   * permadeath removal, turn any non-win captives into rescue quests, then
   * advance the run. Returns a full summary for the render/run-end screen.
   */
  resolve(): ResolveResult {
    if (!this.battle || !this.encounter) throw new Error("RunLoop.resolve: no battle");
    const battle = this.battle;
    const def = this.encounter;
    const policy = runDifficulty(this.run);
    const outcome = battle.outcome();
    const winner = outcome.winner;
    const won = winner === "player";

    // Rewards + material recovery (win only).
    let goldEarned = 0;
    const recovered: string[] = [];
    if (won) {
      const mods = moraleModifiers(moraleTier(this.run.camp.morale));
      goldEarned = Math.round(def.reward.gold * (1 + mods.goldFindBonus));
      // Loot routes to the PURSE (D34), auto-repaying any Banker debt first (D30).
      gainRunGold(this.run, goldEarned);
      for (const drop of def.reward.materials) {
        // Add drops up to the storage cap; overflow is simply lost (D6).
        for (let i = 0; i < drop.count; i++) addItem(this.run.inventory, drop.id);
      }
      const rec = recoverMaterials(battle.entities.all(), winner, this.run.inventory);
      recovered.push(...rec.recovered);
    }

    // Auto-rescue still-captured allies on a win (D21).
    const rescued: string[] = [];
    const rescueQuests: RescueQuest[] = [];
    for (const u of this.combatants) {
      if (!u.captured) continue;
      if (won) {
        freeCaptive(u);
        rescued.push(u.id);
      } else {
        rescueQuests.push(resolveCaptured(policy, u)); // a follow-up quest, not death
      }
    }

    // Mortality (D9): on a **win**, resolve every downed player combatant per the
    // difficulty policy (Easy full-heal … Hardest permadeath) — the run continues.
    // A **lost** battle is the run-ending wipe itself (the party went down), so the
    // per-unit recovery policy doesn't apply — there's no camp to recover in.
    const downed: DownedOutcome[] = [];
    const permadeaths: string[] = [];
    if (won) {
      for (const u of this.combatants) {
        if (u.alive || u.captured) continue;
        const res = resolveDowned(policy, u);
        downed.push(res);
        if (res.permadeath) {
          removeFromRoster(this.run, u);
          permadeaths.push(u.id);
        }
      }
    }

    // Record the node outcome + advance the night. A win checks the run-complete
    // (final-node) terminal; a loss ends the run here (the party's own wipe).
    const node = currentNode(this.run);
    let over: boolean;
    if (won) {
      recordNight(this.run, {
        nodeId: node.id,
        layer: node.layer,
        kind: node.kind,
        type: def.type,
        winner,
        goldEarned,
        fallen: [...permadeaths],
      });
      over = this.run.over || this.run.complete;
    } else {
      this.run.history.push({
        nodeId: node.id,
        layer: node.layer,
        kind: node.kind,
        type: def.type,
        winner,
        goldEarned: 0,
        fallen: this.combatants.filter((u) => !u.alive).map((u) => u.id),
        night: this.run.night,
      });
      this.run.night += 1;
      this.run.over = true;
      over = true;
    }

    this.battle = undefined;
    this.encounter = undefined;
    this.combatants = [];

    return { winner, goldEarned, recovered, rescued, downed, permadeaths, rescueQuests, over };
  }

  // --- Headless auto-play (tests / fast-forward) ----------------------------

  /**
   * Play **one** node at the run's current position to completion (D22/D23): a
   * **combat** node runs camp → stage → auto-battle → resolve; a **rest** node
   * runs the recovery step. The orchestrator must already be positioned (via
   * {@link choose}). Returns the node played. The interactive render drives the
   * battle itself — this is the headless fast-forward used by {@link autoTraverse}.
   */
  playCurrentNode(): MapNode {
    const node = currentNode(this.run);
    if (node.kind === "rest") {
      this.restNode();
      return node;
    }
    if (node.kind === "event") {
      this.eventNode();
      return node;
    }
    this.camp();
    if (this.isOver()) return node; // a dying clock ran out at camp → wipe
    this.startEncounter();
    this.beginBattle();
    this.autoBattle();
    this.resolve();
    return node;
  }

  /**
   * **Pick-first-reachable** traversal of the whole map to a terminal state
   * (D22) — deterministically choosing the first reachable node each step and
   * playing it, until the run is **over** (wipe / lost) or **complete** (final
   * node cleared). Returns the route taken. Lets a headless test play an entire
   * map to a wipe/clear and replay a seed.
   */
  autoTraverse(maxNodes = 100): string[] {
    let guard = 0;
    while (!this.isTerminal() && guard++ < maxNodes) {
      const next = this.reachable();
      if (next.length === 0) break; // only the final node has none — defensive
      this.choose(next[0].id);
      this.playCurrentNode();
    }
    return [...this.run.path];
  }

  /**
   * Play the current battle to a decision **deterministically** — both sides use
   * the same nearest-enemy AI, threading no randomness beyond the clock's stable
   * tie-breaks. Returns the winning side. Used by the full-loop integration test
   * (and as a "simulate" hook); the interactive render drives the battle itself.
   */
  autoBattle(maxTurns = 1000): "player" | "enemy" | undefined {
    if (!this.battle) throw new Error("RunLoop.autoBattle: no staged battle");
    const battle = this.battle;
    for (let i = 0; i < maxTurns; i++) {
      const o = battle.outcome();
      if (o.over) return o.winner;
      const actor = battle.nextActor();
      if (!actor) break;
      const plan = planEnemyTurn(actor, battle.units, battle.grid, {
        isCharging: (u) => battle.clock.isCharging(u),
      });
      if (plan.path.length > 0) battle.moveUnit(actor, plan.path);
      if (plan.ability && plan.target?.alive) {
        battle.useSkill(actor, plan.ability, plan.target);
        continue;
      }
      if (plan.target && plan.target.alive) battle.attack(actor, plan.target);
      battle.endTurn(actor, { moved: plan.path.length > 0, acted: plan.target !== null });
    }
    return battle.outcome().winner;
  }
}
