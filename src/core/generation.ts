/**
 * Procedural encounter generation (M6) — pure and **seed-driven**.
 *
 * Given a deterministic {@link Rng} stream, produces a complete encounter: a
 * {@link TileGrid} (dimensions + blocked tiles), an **enemy roster**
 * (count/stats/positions), the **encounter type** (open-field vs fortified, D12),
 * and **rewards** (gold + materials). The same seed ⇒ the same encounter, always
 * (the run derives each encounter's stream from `streamFor(seed, "enc:N")`, so
 * replay reproduces every map and roster exactly).
 *
 * **Data-driven (D3/D4 ethos):** enemy kinds and reward tables are *data*
 * ({@link ENEMY_TEMPLATES}, {@link REWARD_TABLE}), not hard-coded branches.
 * Difficulty scales with the encounter `index` so a run ramps toward a wipe.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { GridCoord } from "./iso";
import { TileGrid } from "./grid";
import { createUnit, type Unit, type UnitSpec } from "./units";
import type { JobId } from "./jobs";
import type { Rng } from "./rng";

/** Encounter shape (D12): an open scrap, or a prepped/fortified position. */
export type EncounterType = "open-field" | "fortified";

/** An authored enemy kind — pure data the generator draws from. */
export interface EnemyTemplate {
  id: string;
  name: string;
  speed: number;
  maxHp: number;
  attack: number;
  defense: number;
  moveRange: number;
  sightRadius: number;
  awareness: number;
  /** Relative pick weight. */
  weight: number;
  /**
   * The **thief archetype** (D30): a fast, fragile raider that skims the run
   * **purse** mid-battle and bolts for the map edge ({@link "./theft"}). Killed
   * before it escapes drops the loot; escaped keeps it. Data, not a branch.
   */
  thief?: boolean;
  /** Ranged reach (D40): a bowman attacks from afar without closing. Default 1. */
  attackRange?: number;
  /** Job id granting the archetype an ability (e.g. the snare-trapper's Snare). */
  jobId?: JobId;
}

/** The enemy roster table (D4 ethos: enemies are data). */
export const ENEMY_TEMPLATES: readonly EnemyTemplate[] = [
  { id: "goblin", name: "Goblin", speed: 11, maxHp: 16, attack: 6, defense: 1, moveRange: 4, sightRadius: 5, awareness: 2, weight: 5 },
  { id: "brute", name: "Brute", speed: 7, maxHp: 30, attack: 9, defense: 3, moveRange: 3, sightRadius: 4, awareness: 2, weight: 3 },
  { id: "archer", name: "Archer", speed: 10, maxHp: 18, attack: 8, defense: 1, moveRange: 4, sightRadius: 6, awareness: 3, weight: 3 },
  { id: "warg", name: "Warg", speed: 14, maxHp: 20, attack: 7, defense: 2, moveRange: 5, sightRadius: 5, awareness: 3, weight: 2 },
  // The thief (D30): fast + fragile, light pick weight. Its `thief` flag arms the
  // mid-battle purse-skim vector ({@link "./theft"}); the Banker's protection blunts it.
  { id: "thief", name: "Thief", speed: 15, maxHp: 14, attack: 5, defense: 1, moveRange: 6, sightRadius: 6, awareness: 4, weight: 2, thief: true },
];

/**
 * The **bandit archetypes** the demo quest needs (D42/D44) — kept out of the
 * procedural pool above (weight not in `ENEMY_TEMPLATES`); authored encounters
 * place them by id. Thug (melee) · Bowman (ranged, kites) · Snare-Trapper
 * (the Immobilize debuffer — enemy ability use) · Sapper (cuts the bridge) ·
 * Captain (the tough mini-boss brawler).
 */
export const BANDIT_TEMPLATES: Record<string, EnemyTemplate> = {
  "bandit-thug": { id: "bandit-thug", name: "Bandit Thug", speed: 9, maxHp: 22, attack: 8, defense: 2, moveRange: 4, sightRadius: 5, awareness: 2, weight: 0 },
  "bandit-bowman": { id: "bandit-bowman", name: "Bandit Bowman", speed: 11, maxHp: 16, attack: 7, defense: 1, moveRange: 4, sightRadius: 6, awareness: 3, weight: 0, attackRange: 3 },
  "bandit-cutthroat": { id: "bandit-cutthroat", name: "Bandit Cutthroat", speed: 13, maxHp: 18, attack: 9, defense: 1, moveRange: 5, sightRadius: 6, awareness: 3, weight: 0 },
  "snare-trapper": { id: "snare-trapper", name: "Snare-Trapper", speed: 10, maxHp: 18, attack: 5, defense: 1, moveRange: 4, sightRadius: 6, awareness: 4, weight: 0, jobId: "snare-trapper" },
  sapper: { id: "sapper", name: "Sapper", speed: 10, maxHp: 20, attack: 6, defense: 1, moveRange: 4, sightRadius: 5, awareness: 2, weight: 0 },
  "bandit-captain": { id: "bandit-captain", name: "Bandit Captain", speed: 11, maxHp: 48, attack: 12, defense: 4, moveRange: 4, sightRadius: 5, awareness: 3, weight: 0 },
};

/** Look up a bandit (or procedural) template by id. */
export function getEnemyTemplate(id: string): EnemyTemplate | undefined {
  return BANDIT_TEMPLATES[id] ?? ENEMY_TEMPLATES.find((t) => t.id === id);
}

/** A material drop (an id + how many). */
export interface MaterialDrop {
  id: string;
  count: number;
}

/** What a won encounter pays out. */
export interface EncounterReward {
  gold: number;
  materials: MaterialDrop[];
  /**
   * Objective XP awarded to surviving combatants on a **win** (D53) — folded into
   * the reward so it's forfeited with everything else on objective-failure/wipe.
   * Optional: procedural encounters omit it (combat-event XP still accrues).
   */
  xp?: number;
}

/** The reward material table (D4 ethos: drops are data). */
export const REWARD_TABLE: readonly { id: string; weight: number }[] = [
  { id: "trap-kit", weight: 4 },
  { id: "rune-reagent", weight: 2 },
];

/** A fully-specified, deterministic encounter. */
export interface EncounterDef {
  index: number;
  type: EncounterType;
  cols: number;
  rows: number;
  blocked: GridCoord[];
  /** Enemy specs (positions on the right side of the grid). */
  enemies: UnitSpec[];
  reward: EncounterReward;
}

/** Generation tuning — all data, no magic numbers buried in logic. */
export const GEN = {
  cols: 8,
  rows: 6,
  /** Enemy count = base + floor(index * growth), capped. */
  baseEnemies: 2,
  enemyGrowth: 0.5,
  maxEnemies: 6,
  /** Stat scaling applied per encounter index (HP/attack ramp). */
  hpPerIndex: 2,
  attackPerIndex: 0.5,
  /** Blocked-tile count range (interior cover). */
  minBlocked: 1,
  maxBlocked: 4,
  /** Reward gold = base + index * perIndex, jittered. */
  baseGold: 40,
  goldPerIndex: 15,
  /**
   * Sellable-loot (D61): valuables dropped as the *illiquid* half of a reward
   * (found `gold` stays the Upkeep baseline; this is the upside you Sell at a
   * market). Count = base + floor(index * perIndex) + a small jitter.
   */
  baseValuables: 1,
  valuablesPerIndex: 0.5,
  /** Chance an encounter is fortified (D12), rising slightly with index. */
  fortifiedBaseChance: 0.2,
  fortifiedPerIndex: 0.05,
} as const;

/** Enemy count for an encounter index (ramps so a run trends toward a wipe). */
export function enemyCount(index: number): number {
  return Math.min(GEN.maxEnemies, GEN.baseEnemies + Math.floor(index * GEN.enemyGrowth));
}

/**
 * Interior cover (D12): scatter up to `count` **unique** blocked tiles across the
 * middle columns (never the home/enemy spawn columns), de-duplicated. The `guard`
 * caps retries so a dense board can't spin. Consumes `count`-worth of `rng`.
 */
function rollBlocked(rng: Rng, cols: number, rows: number, count: number): GridCoord[] {
  const blocked: GridCoord[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (blocked.length < count && guard++ < 50) {
    const col = rng.range(2, cols - 3);
    const row = rng.range(0, rows - 1);
    const key = `${col},${row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocked.push({ col, row });
  }
  return blocked;
}

/**
 * The enemy roster: count ramps with `index`, stats scale, bodies placed down the
 * right columns avoiding blockers and collisions (the inner `pg` loop caps retries).
 */
function rollRoster(rng: Rng, index: number, cols: number, rows: number, blocked: readonly GridCoord[]): UnitSpec[] {
  const count = enemyCount(index);
  const hpBoost = Math.round(GEN.hpPerIndex * index);
  const atkBoost = Math.round(GEN.attackPerIndex * index);
  const rightCols = [cols - 1, cols - 2];
  const usedRows = new Set<string>();
  const enemies: UnitSpec[] = [];
  for (let i = 0; i < count; i++) {
    const tpl = rng.pickWeighted(ENEMY_TEMPLATES, (t) => t.weight);
    // Place down the right columns, avoiding blocked tiles and collisions.
    let pos: GridCoord = { col: rightCols[i % rightCols.length], row: i % rows };
    let pg = 0;
    while (pg++ < 30) {
      const col = rng.pick(rightCols);
      const row = rng.range(0, rows - 1);
      const key = `${col},${row}`;
      if (usedRows.has(key) || blocked.some((b) => b.col === col && b.row === row)) continue;
      usedRows.add(key);
      pos = { col, row };
      break;
    }
    enemies.push({
      id: `e${index}-${i}-${tpl.id}`,
      name: tpl.name,
      side: "enemy",
      pos,
      speed: tpl.speed,
      maxHp: tpl.maxHp + hpBoost,
      attack: tpl.attack + atkBoost,
      defense: tpl.defense,
      moveRange: tpl.moveRange,
      sightRadius: tpl.sightRadius,
      awareness: tpl.awareness,
      thief: tpl.thief,
      attackRange: tpl.attackRange,
      jobId: tpl.jobId,
    });
  }
  return enemies;
}

/** The reward: gold scales with `index` (jittered) plus one or two material drops. */
function rollReward(rng: Rng, index: number): EncounterReward {
  const gold = GEN.baseGold + GEN.goldPerIndex * index + rng.range(0, 20);
  const dropCount = 1 + rng.int(2);
  const materials: MaterialDrop[] = [];
  for (let i = 0; i < dropCount; i++) {
    const id = rng.pickWeighted(REWARD_TABLE, (m) => m.weight).id;
    const existing = materials.find((m) => m.id === id);
    if (existing) existing.count += 1;
    else materials.push({ id, count: 1 });
  }
  // Sellable loot (D61) — the illiquid half, pushed last so functional drops keep
  // storage priority. Drawn here at the tail of the roll (no earlier draw shifts).
  const valuables = GEN.baseValuables + Math.floor(index * GEN.valuablesPerIndex) + rng.int(2);
  if (valuables > 0) materials.push({ id: "valuables", count: valuables });
  return { gold, materials };
}

/**
 * Generate an encounter from a deterministic stream. Same `rng` sequence + same
 * `index` ⇒ identical encounter. The render layer never calls this directly; the
 * run derives `rng` from its seed so a replay reproduces the sequence. The roll
 * order — type, blocked tiles, roster, reward — is the determinism contract; the
 * `rng.range` for the blocked count is an argument so it still draws before scatter.
 */
export function generateEncounter(rng: Rng, index: number): EncounterDef {
  const { cols, rows } = GEN;

  // Encounter type (D12) — fortified chance creeps up with index.
  const fortChance = GEN.fortifiedBaseChance + GEN.fortifiedPerIndex * index;
  const type: EncounterType = rng.chance(fortChance) ? "fortified" : "open-field";

  const blocked = rollBlocked(rng, cols, rows, rng.range(GEN.minBlocked, GEN.maxBlocked));
  const enemies = rollRoster(rng, index, cols, rows, blocked);
  const reward = rollReward(rng, index);

  return { index, type, cols, rows, blocked, enemies, reward };
}

/** Build a live {@link TileGrid} from an encounter def. */
export function buildGrid(def: EncounterDef): TileGrid {
  return new TileGrid(def.cols, def.rows, def.blocked);
}

/** Inflate an encounter's enemy specs into live {@link Unit}s. */
export function buildEnemies(def: EncounterDef): Unit[] {
  return def.enemies.map((spec) => createUnit(spec));
}
