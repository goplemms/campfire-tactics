/**
 * Telegraph / action-forecast — the **core** half of the preview-before-commit
 * system (D64). Two pure, read-only reads the render layer paints but never
 * computes:
 *
 * - {@link abilityFootprint} — the *geometry* half: the set of tiles/units an
 *   armed ability affects **given the current aim** (Cleave's arc, Shove's push +
 *   landing, a single target, a placement tile, self, or nothing for a party/camp
 *   meta target). The spec's footprint table, made data.
 * - {@link forecastSkill} + {@link FORECAST_HANDLERS} — the *numbers* half: the
 *   non-mutating predicted outcome of resolving the ability on that footprint,
 *   as a **tagged** {@link AbilityForecast} (immediate / computed / conditional /
 *   deferred / banked / tiered / branching — outcomes come in kinds, not one
 *   number).
 *
 * **The keystone (D64).** {@link FORECAST_HANDLERS} is a compile-time-exhaustive
 * mapped type over the *whole* {@link SkillEffect} union — **all four partitions**
 * ({@link BattleEffect}/{@link FieldEffect}/{@link CampEffect}/
 * {@link DeploymentEffect}), mirroring {@link BATTLE_EFFECT_HANDLERS}'s pattern.
 * Adding *any* effect kind, in any partition, fails the build here until it has a
 * forecaster — so the telegraph can never silently fall out of sync with the
 * ability roster. (The first draft keyed only on `BattleEffect`; the 5-job audit
 * caught that 3 of 5 signature jobs act through a non-battle partition —
 * `placeTrap`, `morale`, `cleave`/`forced-move` — and corrected the scope.)
 *
 * **Single source of truth (read-only).** A forecast never mutates (it never
 * calls `removeItem`/`applyStatus`/`markPrey`/`clock.schedule`) and never
 * re-implements the resolver's arithmetic. Where a resolver fused compute+mutate
 * the build extracted the pure predict-core both now call ({@link medHealAmount},
 * {@link triageHealAmount}, {@link healAmount}, {@link computeDamage}); the
 * geometry cores ({@link cleaveArc}, {@link shoveLanding}) live here and the
 * resolver (`turn.ts`) calls *them*, so footprint == what resolution walks.
 *
 * **Non-goal (D64).** We *label* deferred/conditional outcomes — "12 + Immobilize
 * if a foe enters", "Morale → High" — we do **not** simulate them (no AI-path or
 * downstream-morale projection). Forecasts stay single-action reads. Best-case
 * per target, honest about variance the way the route forecast (D48) is honest
 * about fog.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";
import type { GridCoord } from "./iso";
import type { TileGrid } from "./grid";
import type { Inventory } from "./inventory";
import { countOf } from "./inventory";
import { manhattan, computeDamage, PASSIVE } from "./combat";
import { abilityScaleBonus } from "./leveling";
import { isDebuffed, markOf, CHANNEL_TUNING } from "./status";
import { moraleTier, type MoraleTier } from "./camp";
import { moraleModifiers } from "./morale";
import {
  medHealAmount,
  healAmount,
  triageHealAmount,
  MED_HEAL,
  type SkillDef,
  type SkillEffect,
} from "./skills";

// ===========================================================================
// Footprint — the geometry half (D64)
// ===========================================================================

/**
 * The geometry an armed ability affects, **given the current aim**. A tagged union
 * over the spec's footprint table — `kind` tells the render which overlay to paint:
 *
 * - `single` — one aimed tile (`damage`/`heal`/`status`/`channel`/`cleanse`).
 * - `arc` — Cleave's 90° melee arc (the swept tiles + the foes caught).
 * - `push` — Shove's target tile **and** its landing, flagged if it stops short on
 *   a blocker or lands on a trap/entity (the D19 push-into-trap read).
 * - `placement` — a Set Trap's claimed tile (a *tile* target chosen in Deployment).
 * - `self` — the caster's own tile (a self-buff like Reposition/Dash/Defend).
 * - `none` — a party/camp meta target with no board anchor (the floating forecast).
 */
export type AbilityFootprint =
  | { kind: "single"; tile: GridCoord; units: Unit[] }
  | { kind: "arc"; tiles: GridCoord[]; units: Unit[] }
  | { kind: "push"; target: GridCoord; landing: GridCoord; tiles: number; blocked: boolean; ontoEntity: boolean }
  | { kind: "placement"; tile: GridCoord }
  | { kind: "self"; tile: GridCoord }
  | { kind: "none" };

/**
 * The Heavy Knight **Cleave** arc (D40): the three-tile 90° melee arc facing
 * `dir` from `caster.pos` — the orthogonal tile plus its two flanking diagonals.
 * The single source of the arc geometry: `turn.ts`'s `execCleave` calls this, so
 * the telegraph washes exactly the tiles resolution will sweep. `dir` is a unit
 * step vector (one of ±col / ±row). Pure; no walkability mask — the arc is by
 * geometry, and resolution simply finds no foe on a wall tile (matching today's
 * resolver, which does not mask the arc).
 */
export function cleaveArc(caster: GridCoord, dir: GridCoord): GridCoord[] {
  return dir.col !== 0
    ? [
        { col: caster.col + dir.col, row: caster.row },
        { col: caster.col + dir.col, row: caster.row - 1 },
        { col: caster.col + dir.col, row: caster.row + 1 },
      ]
    : [
        { col: caster.col, row: caster.row + dir.row },
        { col: caster.col - 1, row: caster.row + dir.row },
        { col: caster.col + 1, row: caster.row + dir.row },
      ];
}

/** Where a forced move ends up + why it stopped — the pure {@link shoveLanding} result. */
export interface ShoveLanding {
  /** The tile the pushed unit ends on (its own tile if it can't budge). */
  landing: GridCoord;
  /** Tiles it actually moved (≤ requested). */
  moved: number;
  /** True if it stopped short of `tiles` on a wall/body (the collision, D19). */
  blocked: boolean;
}

/**
 * The pure landing of a **forced move** (D19 push): step `target` `tiles` tiles
 * along the orthogonal away-vector from `caster`, stopping at the first
 * non-walkable tile or occupied body. The single source of the shove path:
 * `turn.ts`'s `resolveShove` calls this to walk the move, so the telegraph's
 * landing tile is exactly where the resolver puts the unit. `occupied` answers
 * "is this tile blocked by another body?" (the caller excludes the pushed unit
 * itself, matching the resolver). Pure — mutates nothing.
 */
export function shoveLanding(
  caster: GridCoord,
  target: GridCoord,
  tiles: number,
  isWalkable: (c: GridCoord) => boolean,
  occupied: (c: GridCoord) => boolean,
): ShoveLanding {
  const dc = Math.sign(target.col - caster.col);
  const dr = Math.sign(target.row - caster.row);
  let pos = target;
  let moved = 0;
  for (let i = 0; i < tiles; i++) {
    const next = { col: pos.col + dc, row: pos.row + dr };
    if (!isWalkable(next) || occupied(next)) break;
    pos = next;
    moved += 1;
  }
  return { landing: pos, moved, blocked: moved < tiles };
}

/** Living foes of `caster` standing on one of `tiles`. */
function foesOn(caster: Unit, tiles: GridCoord[], units: readonly Unit[]): Unit[] {
  const keys = new Set(tiles.map((t) => `${t.col},${t.row}`));
  return units.filter((u) => u.alive && u.side !== caster.side && keys.has(`${u.pos.col},${u.pos.row}`));
}

/**
 * The {@link AbilityFootprint} an armed `skill` affects, **given the current aim**
 * — the geometry half of the telegraph (D64). `aim` is the hovered tile (a unit's
 * tile for a targeted skill, the chosen tile for a placement). For a self skill
 * the caster's tile is the footprint; for a party/camp meta skill there is no
 * board anchor (`none`). Pure and read-only — recomputable every frame as the aim
 * moves. The `grid`/`units` let the push read its landing through blockers (D19).
 */
export function abilityFootprint(
  skill: SkillDef,
  caster: Unit,
  aim: GridCoord,
  grid: TileGrid,
  units: readonly Unit[],
): AbilityFootprint {
  const effect = skill.effect;
  switch (effect.kind) {
    case "damage":
    case "heal":
    case "status":
    case "channel":
    case "triage-heal":
    case "cleanse":
    case "med-heal":
    case "guard-allies": {
      // A self-targeted battle/field skill (Reposition/Dash/Defend/Turtle) anchors on
      // the caster; everything else is the single aimed tile.
      if (skill.target === "self") return { kind: "self", tile: caster.pos };
      const onTile = units.filter((u) => u.alive && u.pos.col === aim.col && u.pos.row === aim.row);
      return { kind: "single", tile: aim, units: onTile };
    }
    case "cleave": {
      // Direction = caster → aim, snapped to the dominant orthogonal step (the arc
      // is chosen by where you point). A zero vector (aim on the caster) defaults
      // to "up" so the telegraph always shows an arc.
      const dir = aimDirection(caster.pos, aim);
      const tiles = cleaveArc(caster.pos, dir);
      return { kind: "arc", tiles, units: foesOn(caster, tiles, units) };
    }
    case "forced-move": {
      const land = shoveLanding(
        caster.pos,
        aim,
        effect.tiles,
        (c) => grid.isWalkable(c),
        (c) => units.some((u) => u.alive && (u.pos.col !== aim.col || u.pos.row !== aim.row) && u.pos.col === c.col && u.pos.row === c.row),
      );
      // `ontoEntity` is the "push into a trap/blocker" combo flag (D19). Field
      // entities (traps) aren't in `units` — they live in the EntityRegistry the
      // render layer holds — so the *core* footprint reports the landing tile +
      // the `blocked` collision; the render overlays the into-trap badge by
      // reading its own registry at `landing`. Always false here (no entity model
      // in scope), kept in the shape so the render has the field to fill.
      return { kind: "push", target: aim, landing: land.landing, tiles: land.moved, blocked: land.blocked, ontoEntity: false };
    }
    case "placeTrap":
      // A tile target chosen in Deployment (target "camp") — the claimed tile.
      return { kind: "placement", tile: aim };
    case "morale":
    case "openMarket":
    case "primeDeal":
    case "provisionMeal":
    case "survey":
      // A party/camp/overworld meta target — no battle-board footprint (Survey aims at a
      // *map* node via opts, not a grid tile; floating forecast box).
      return { kind: "none" };
  }
}

/** Snap the caster→aim vector to its dominant orthogonal unit step (arc/dual-reach helper). */
function aimDirection(from: GridCoord, to: GridCoord): GridCoord {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (dc === 0 && dr === 0) return { col: 0, row: -1 }; // default "up"
  if (Math.abs(dc) >= Math.abs(dr)) return { col: Math.sign(dc), row: 0 };
  return { col: 0, row: Math.sign(dr) };
}

// ===========================================================================
// Forecast — the numbers half (D64): a tagged outcome, not a number
// ===========================================================================

/** A flank/lethal glyph the render keeps from the strike-badge vocabulary (D60). */
export interface DamageGlyphs {
  /** True if the modelled hit would drop the target (best-case-per-target). */
  lethal?: boolean;
}

/**
 * The predicted outcome of resolving an armed ability — a **tagged** structure,
 * because outcomes come in kinds (D64). The render's forecast `MiniCard` switches
 * on `kind`:
 *
 * - `immediate` — a settled value now (HK Cleave damage, a flat heal/status).
 * - `computed` — a value derived live from caster/target/passive state (Triage
 *   heal = base + level-scale + ⌊triage × missingHP⌋).
 * - `conditional` — `if <cond>: <delta>` (Hunter Deadeye "vs debuffed +N";
 *   a trap "if a foe enters: dmg + rider").
 * - `deferred` — `0 now → <per-future-hit>` / `<outcome> in ~Nt` (Mark Prey ramp,
 *   a charged Mend).
 * - `banked` — an outcome that lands **next battle** (Cook's party heal).
 * - `tiered` — `<from> → <to>` + the bundle the tier grants (Cook morale).
 * - `branching` — one row per inventory-gated sub-choice (Medic Heal per herb).
 */
export type AbilityForecast =
  | { kind: "immediate"; label: string; value: number; glyphs?: DamageGlyphs }
  | { kind: "computed"; label: string; value: number; glyphs?: DamageGlyphs }
  | { kind: "conditional"; label: string; value: number; condition: string; bonus: number; glyphs?: DamageGlyphs }
  | { kind: "deferred"; label: string; now: number; perHit?: number; cap?: number; etaTurns?: number }
  | { kind: "banked"; label: string; value: number; tier?: MoraleTier }
  | { kind: "tiered"; label: string; from: MoraleTier; to: MoraleTier; modifiers: ReturnType<typeof moraleModifiers>; banked?: number }
  | { kind: "branching"; label: string; rows: ForecastRow[] };

/** One row of a {@link AbilityForecast} `branching` outcome (a Medic herb choice). */
export interface ForecastRow {
  /** The sub-choice id (the herb material id). */
  id: string;
  /** Display label ("Salve", "Stimulant", "Antidote"). */
  label: string;
  /** The heal this sub-choice would apply (the predict-core figure). */
  value: number;
  /** A short rider tag ("&  cleanse", "& Hastened"), if any. */
  rider?: string;
  /** False if the sub-choice is unaffordable / out of stock — greyed, not hidden (D64). */
  available: boolean;
}

/**
 * Optional live context a forecast reads — the **same state the resolver/gate
 * reads**, never a second source (D64). The forecast is read-only: it inspects
 * these, it never mutates them.
 */
export interface ForecastCtx {
  /** The aimed target unit (for a targeted battle skill). */
  target?: Unit;
  /** Living units, so a damage forecast is flank-aware (matches `computeDamage`). */
  units?: readonly Unit[];
  /** The shared stash, so a Medic Heal forecast gates each herb row (D64). */
  inventory?: Inventory;
  /** Current party morale value, so the Cook's tiered forecast reads from→to (D8). */
  morale?: number;
}

/** What a {@link FORECAST_HANDLERS} entry resolves against. */
interface ForecastEffectCtx extends ForecastCtx {
  caster: Unit;
}

/** The medical herbs a Medic Heal can branch on, in display order (D40). */
const MED_HERBS: readonly { id: string; label: string }[] = [
  { id: "salve", label: "Salve" },
  { id: "stimulant", label: "Stimulant" },
  { id: "antidote", label: "Antidote" },
];

/**
 * The **forecast registry** — the D64 keystone. A handler per {@link SkillEffect}
 * kind, the mapped type `{ [K in SkillEffect["kind"]]: ... }` **exhaustive at
 * compile time over the whole union** (all four partitions, not just
 * {@link BattleEffect} — the bug the 5-job audit caught). Adding any effect kind
 * to {@link SkillEffect} fails the build here until its forecaster is written,
 * exactly as {@link BATTLE_EFFECT_HANDLERS} forces a resolver. Each handler is
 * keyed to its variant via `Extract`, so `effect` is fully typed inside, and is
 * **read-only** — it computes via the shared predict-cores and mutates nothing.
 */
const FORECAST_HANDLERS: {
  [K in SkillEffect["kind"]]: (effect: Extract<SkillEffect, { kind: K }>, ctx: ForecastEffectCtx) => AbilityForecast;
} = {
  // --- Battle partition ----------------------------------------------------
  damage: (effect, { caster, target, units }) => {
    // Deadeye (D40) is a *conditional* read: the registry surfaces the +N a
    // debuffed target would suffer separately from the base hit, so the box can
    // show "Damage 12 (vs debuffed +4)". computeDamage already folds in flank +
    // Mark + Deadeye, so we read it twice — once with the live target state, once
    // as the conditional delta — never re-deriving the arithmetic (D64).
    const power = caster.attack + effect.bonusAttack + abilityScaleBonus(caster);
    const deadeye = caster.passives[PASSIVE.deadeye] ?? 0;
    if (target) {
      const value = computeDamage(caster, target, power, units);
      const glyphs: DamageGlyphs = { lethal: value >= target.hp };
      if (deadeye > 0 && !isDebuffed(target)) {
        // The bonus only lands if the target becomes debuffed — a conditional.
        return { kind: "conditional", label: "Damage", value, condition: "vs debuffed", bonus: deadeye, glyphs };
      }
      return { kind: "immediate", label: "Damage", value, glyphs };
    }
    // No live target (a roster-less preview): report the raw power as immediate.
    return { kind: "immediate", label: "Damage", value: power };
  },
  heal: (effect, { caster }) =>
    // Computed (D64): a flat heal that scales live with the caster's job level
    // (Mend heals more as the Medic levels). Whether it's instant or charged
    // (Mend) is a skill-level `cost`, surfaced by the availability layer
    // ({@link "./clock".scheduledProgress}) — not the effect's outcome shape.
    ({ kind: "computed", label: "Heal", value: healAmount(caster, effect.amount) }),
  status: (effect) => {
    // A status application is a *labelled* outcome (name + duration); there's no
    // number to forecast, so we report the duration as the value for the row.
    return { kind: "immediate", label: effect.status.name, value: effect.status.duration };
  },
  channel: (_effect, { caster }) => {
    // Mark Prey (D37) is the canonical *deferred* outcome: 0 damage now, then
    // +perStack per consecutive hit on the locked prey up to a cap. Read the
    // caster's live channel if open (so a re-mark shows the running cap), else the
    // channel tuning defaults.
    const m = markOf(caster);
    const perStack = (m?.data?.perStack as number) ?? CHANNEL_TUNING.markPerStack;
    const cap = (m?.data?.cap as number) ?? CHANNEL_TUNING.markCap;
    return { kind: "deferred", label: "Mark Prey", now: 0, perHit: perStack, cap: perStack * cap };
  },
  "triage-heal": (effect, { caster, target }) => {
    // Computed (D64): scales live with the caster's level + Triage passive + the
    // target's missing HP — the shared predict-core, so forecast == resolution.
    const value = target ? triageHealAmount(caster, target, effect.amount) : healAmount(caster, effect.amount);
    return { kind: "computed", label: "Heal", value };
  },
  cleanse: () => ({ kind: "immediate", label: "Cleanse", value: 1 }),

  // --- Field partition -----------------------------------------------------
  cleave: (effect, { caster, target, units }) => {
    // The arc's best-case-per-target damage (D64 "best-case, not banded"): model
    // the hit on the aimed foe via computeDamage (flank/Mark/Deadeye-aware),
    // matching what each per-foe resolveAttack will apply. The per-foe list comes
    // from the footprint; the box shows a badge per caught foe.
    const power = caster.attack + effect.bonusAttack + abilityScaleBonus(caster);
    if (target) {
      const value = computeDamage(caster, target, power, units);
      return { kind: "immediate", label: "Damage", value, glyphs: { lethal: value >= target.hp } };
    }
    return { kind: "immediate", label: "Damage", value: power };
  },
  "forced-move": (effect, { caster, target, units }) => {
    // Shove's payoff is the *displacement* (+ an optional shove hit). If it carries
    // bonus damage, forecast that hit; else report the push distance as the value.
    if (effect.bonusAttack && target) {
      const power = caster.attack + effect.bonusAttack + abilityScaleBonus(caster);
      const value = computeDamage(caster, target, power, units);
      return { kind: "immediate", label: "Shove damage", value, glyphs: { lethal: value >= target.hp } };
    }
    return { kind: "immediate", label: "Push", value: effect.tiles };
  },
  "med-heal": (_effect, { caster, target, inventory }) => {
    // Branching (D64): one row per herb, the heal from the shared medHealAmount
    // predict-core, each row inventory-gated (greyed when out of stock, not
    // hidden — you learn what provisioning would unlock). The rider tags the row.
    const rows: ForecastRow[] = MED_HERBS.map(({ id, label }) => {
      const { amount, rider } = target
        ? medHealAmount(caster, target, id)
        : { amount: MED_HEAL.base + abilityScaleBonus(caster) + (id === "salve" ? MED_HEAL.salveBonus : 0), rider: { kind: "none" } as const };
      const riderTag = rider.kind === "hasten" ? "& Hastened" : rider.kind === "cleanse" ? "& cleanse" : undefined;
      const available = inventory ? countOf(inventory, id) > 0 : true;
      return { id, label, value: amount, rider: riderTag, available };
    });
    return { kind: "branching", label: "Heal", rows };
  },
  "guard-allies": (effect) =>
    // The Soldier's Turtle Formation (D66): an "AoE Defend" — each adjacent ally
    // gains Guard (−amount damage) until its next turn. A flat, immediate buff.
    ({ kind: "immediate", label: "Guard allies", value: effect.amount }),

  // --- Camp partition ------------------------------------------------------
  morale: (effect, { morale }) => {
    // Banked + tiered (D64): the Cook's stew lifts morale a tier (from → to, with
    // the bundle the new tier grants, D8) AND banks a between-battle party heal
    // (cross-screen). The render shows both — the tier transition and the banked HP.
    const from = moraleTier(morale ?? 0);
    const to = moraleTier((morale ?? 0) + effect.morale);
    return {
      kind: "tiered",
      label: "Morale",
      from,
      to,
      modifiers: moraleModifiers(to),
      banked: effect.partyHeal,
    };
  },

  // --- Deployment partition ------------------------------------------------
  placeTrap: (effect) => {
    // Conditional + deferred (D64): a trap deals nothing now; *if* a foe enters it
    // springs for `damage` (+ an optional rider status, e.g. Immobilize). The
    // condition is the entry; the bonus is the damage. The render adds the rider tag.
    return {
      kind: "conditional",
      label: "Trap",
      value: 0,
      condition: "if a foe enters",
      bonus: effect.damage,
    };
  },

  // --- Overworld / camp economy partition (D72) ----------------------------
  // These resolve on the between-nodes beat, not the combat clock, so their forecast
  // is a simple immediate readout (no target/HP math) — but the registry stays
  // exhaustive over the *whole* SkillEffect union, so each still owns a handler.
  openMarket: () => ({ kind: "immediate", label: "Open market", value: 1 }),
  primeDeal: () => ({ kind: "immediate", label: "Next deal primed", value: 1 }),
  provisionMeal: (effect) => ({ kind: "immediate", label: "Rest Points", value: effect.rp }),
  survey: (effect) => ({ kind: "immediate", label: "Intel tier", value: effect.tierBump }),
};

/**
 * Forecast an armed ability's outcome — the numbers half of the telegraph (D64).
 * Dispatches `skill.effect` through the exhaustive {@link FORECAST_HANDLERS}
 * registry (the keystone: a forecaster per effect kind across all four
 * partitions). **Read-only** — it computes via the shared predict-cores and
 * mutates nothing, so it is safe to call every frame as the aim/target/HP change.
 * Pass the live {@link ForecastCtx} (target, units, inventory, morale) so the
 * computed/conditional/branching/tiered reads reflect the current state.
 */
export function forecastSkill(skill: SkillDef, caster: Unit, ctx: ForecastCtx = {}): AbilityForecast {
  const effect = skill.effect;
  const handler = FORECAST_HANDLERS[effect.kind] as (e: SkillEffect, c: ForecastEffectCtx) => AbilityForecast;
  return handler(effect, { caster, ...ctx });
}

/**
 * Whether an armed ability would actually *reach* its aimed target right now —
 * the availability read for a targeted skill (the telegraph greys an out-of-range
 * aim). Reuses the same {@link manhattan} range check the action gate uses (D64:
 * read the gate's state, never a second source). Self/party/camp skills are
 * trivially "in range" of their own anchor.
 */
export function aimInRange(skill: SkillDef, caster: Unit, aim: GridCoord): boolean {
  if (skill.target === "self" || skill.target === "party" || skill.target === "camp") return true;
  return manhattan(caster.pos, aim) <= skill.range;
}
