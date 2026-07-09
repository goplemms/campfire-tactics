/**
 * Battle replay driver (D4 event-sourcing) — the `replay(log) === state` invariant.
 *
 * Split out of `turn.ts` (R3, #121): the {@link replay} driver that rebuilds a battle
 * by **re-running** its recorded {@link "./combat-actions".CombatAction} log, and the
 * {@link planActions} lowering ({@link "./ai".AIPlan} → actions) the AI turn shares with
 * it. `Battle` keeps `runEnemyTurn` (which calls {@link planActions}). Pure code motion:
 * behaviour unchanged.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";
import type { TileGrid } from "./grid";
import type { Inventory } from "./inventory";
import type { AIPlan } from "./ai";
import { commitsTurn, type CombatAction } from "./combat-actions";
import { Battle, type BattleOptions } from "./turn";

/**
 * Lower an {@link AIPlan} (intent-as-data, D42) to the {@link CombatAction}s that
 * realize it — the *plan → actions* half of the AI/player convergence. Mirrors the
 * old `runEnemyTurn` ordering exactly: an optional move, then **either** a
 * turn-ending ability (the snare) **or** an optional attack followed by an explicit
 * `endTurn`. A skill commits the turn itself, so no `endTurn` follows it.
 */
export function planActions(plan: AIPlan): CombatAction[] {
  const unit = plan.unit.id;
  const actions: CombatAction[] = [];
  if (plan.path.length > 0) actions.push({ kind: "move", unit, path: plan.path.map((t) => ({ ...t })) });
  if (plan.ability && plan.target?.alive) {
    actions.push({ kind: "skill", unit, skill: plan.ability.id, target: plan.target.id, commitTurn: true });
    return actions; // the skill ends the turn (commitSkill spends the CT)
  }
  if (plan.target?.alive) actions.push({ kind: "attack", unit, target: plan.target.id });
  actions.push({ kind: "endTurn", unit, spend: { moved: plan.path.length > 0, acted: plan.target !== null } });
  return actions;
}

/**
 * **Replay** a recorded action {@link Battle.log} from an initial roster and assert it
 * reconstructs the same battle (the `replay(initial, log) === state` invariant —
 * the combat analog of the purse journal's `sum(log) === gold`). Combat state is a
 * graph, not a scalar, so it rebuilds by **re-running** rather than summing: build a
 * fresh {@link Battle} from `initialUnits` (a pre-construction snapshot), seed it
 * identically, then drive the deterministic, RNG-free turn loop — for each
 * {@link Battle.nextActor} (which ticks the clock + statuses identically), apply the
 * recorded actions for that turn (up to and including the one that {@link
 * commitsTurn commits} it) instead of planning. Returns the rebuilt battle.
 *
 * `initialUnits` is **mutated** (the {@link Battle} constructor stamps passives) —
 * pass throwaway clones of the pre-seed roster. `opts` must carry the **same**
 * {@link BattleOptions} (seed + variance) the original battle used, so any seeded
 * rolls re-derive identically; `moraleBonus` re-applies the initiative warming.
 * `stash` re-wires the shared supply inventory a log with stash-consuming actions
 * (`placeTrap`, `useHeal`) draws from — pass a clone of its **initial** counts.
 */
export function replay(
  grid: TileGrid,
  initialUnits: Unit[],
  log: readonly CombatAction[],
  opts: BattleOptions & { moraleBonus?: number; stash?: Inventory } = {},
): Battle {
  const battle = new Battle(grid, initialUnits, opts);
  if (opts.stash) battle.setStash(opts.stash);
  // Drain the pre-combat prelude (D67): everything up to (and including) the logged
  // `beginBattle` boundary — the deploy actions resolve in the pre-combat phase (no
  // combat commit), then the marker flips to combat — before seeding + driving the loop.
  // A log with no boundary is a pure-combat log (the common test case): no prelude to
  // drain, so seed straight into the combat loop, exactly as before.
  let i = 0;
  const boundary = log.findIndex((a) => a.kind === "beginBattle");
  if (boundary >= 0) {
    battle.enterDeploy(); // the prelude resolves in the pre-combat phase
    while (i <= boundary) battle.apply(log[i++]); // deploy actions + the beginBattle flip → combat
  }
  battle.seed(opts.moraleBonus ?? 0);
  while (i < log.length) {
    const actor = battle.nextActor();
    if (!actor) break;
    // Apply this actor's recorded turn: every turn's actions end in exactly one
    // committing action (an endTurn, a cleave, or a turn-committing skill).
    while (i < log.length) {
      const action = log[i++];
      battle.apply(action);
      if (commitsTurn(action)) break;
    }
  }
  return battle;
}
