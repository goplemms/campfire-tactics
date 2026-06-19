/**
 * Party dossier — a **pure projection** of run state into the rows a between-battle
 * roster screen renders (the `previewNode`/ledger pattern, one tier up).
 *
 * The overworld is deliberately information-light, but that scarcity was only ever
 * meant for the *enemy/world* (intel-fogged, D48). A party's **own** body — HP, the
 * dying clock, capture, carried stock — has no reason to be hidden, and today only
 * fatigue surfaces. This projection gathers the rest so a dossier can show it:
 *
 * - per-member **vitality & jeopardy** (HP, fatigue, the dying-clock, capture),
 * - per-member **growth** (level + XP toward the next),
 * - a party **summary** (morale, upkeep, the HP deficit, and the carried stock that
 *   answers "how much should we provision").
 *
 * Pure logic: no Phaser, no DOM, no `Math.random` — a deterministic read.
 */

import type { RunState } from "./run";
import { primaryJobOf, type Unit } from "./units";
import { getJob } from "./jobs";
import { fatigueTier, type FatigueTier } from "./fatigue";
import { moraleTier, type MoraleTier } from "./camp";
import { computeUpkeep } from "./upkeep";
import { DYING_COUNTER, isDying } from "./mortality";
import { countOf, getMaterial, slotsUsed } from "./inventory";
import { LEVELING } from "./leveling";

/**
 * A member's standout danger, worst-first (`null` = fine). Drives the rail's ⚠ flag
 * and the camp "Party" badge: **dying** (on the permadeath clock) and **captured**
 * are the urgent, time-boxed risks; **down** is felled but not yet on a clock;
 * **critical** is alive but badly wounded.
 */
export type Jeopardy = "dying" | "captured" | "down" | "critical" | null;

/** At or below this HP fraction an alive, free unit reads as **critical**. */
export const CRITICAL_HP_FRACTION = 0.35;

/** Materials surfaced in the party "stock vs need" readout, in display order. */
export const STOCK_ITEMS = ["salve", "stimulant", "antidote", "trap-kit"] as const;

/** Per-member dossier row: the live unit plus the facts derived for display. */
export interface MemberRow {
  /** The live core unit — the source of truth for the full stat block. */
  unit: Unit;
  name: string;
  /** Primary job's display name, or `—` for a jobless unit. */
  jobLabel: string;
  level: number;
  /** XP banked toward the next character level. */
  xp: number;
  /** XP the next level needs (flat for now, D32). */
  xpToNext: number;
  hp: number;
  maxHp: number;
  /** Remaining HP as a 0..1 fraction (for the bar). */
  hpFrac: number;
  fatigue: number;
  fatigueLabel: FatigueTier;
  alive: boolean;
  captured: boolean;
  /** Nights left on the permadeath clock (D9 Hard), or `null` if not dying. */
  dyingNights: number | null;
  jeopardy: Jeopardy;
}

/** One carried-supply line in the party "stock vs need" readout. */
export interface StockLine {
  id: string;
  name: string;
  count: number;
}

/** Party-wide rollup — the Overview tab's content. */
export interface PartySummary {
  morale: number;
  moraleLabel: MoraleTier;
  /** A night's upkeep bill total (gold). */
  upkeep: number;
  /** Total HP missing across the **alive** party — the "how much healing" figure. */
  hpDeficit: number;
  /** How many alive members are below full HP. */
  woundedCount: number;
  /** Members in *urgent* jeopardy (dying / captured / down) — the camp-badge count. */
  jeopardyCount: number;
  storageUsed: number;
  storageCap: number;
  stock: StockLine[];
  /** Banked Rest Points (D9) — the rate that gates how fast rest can heal. */
  rp: number;
}

/** The full dossier projection: a row per roster member + the party summary. */
export interface DossierProjection {
  members: MemberRow[];
  party: PartySummary;
}

/** Classify a unit's standout danger (worst-first). See {@link Jeopardy}. */
export function jeopardyOf(u: Unit): Jeopardy {
  if (isDying(u)) return "dying";
  if (u.captured) return "captured";
  if (!u.alive) return "down";
  if (u.maxHp > 0 && u.hp / u.maxHp <= CRITICAL_HP_FRACTION) return "critical";
  return null;
}

function memberRow(u: Unit): MemberRow {
  const job = getJob(primaryJobOf(u));
  const dying = u.counters?.[DYING_COUNTER] ?? 0;
  return {
    unit: u,
    name: u.name,
    jobLabel: job?.name ?? "—",
    level: u.level,
    xp: u.xp,
    xpToNext: LEVELING.xpPerLevel,
    hp: Math.max(0, u.hp),
    maxHp: u.maxHp,
    hpFrac: u.maxHp > 0 ? Math.max(0, u.hp) / u.maxHp : 0,
    fatigue: u.fatigue,
    fatigueLabel: fatigueTier(u.fatigue),
    alive: u.alive,
    captured: u.captured,
    dyingNights: dying > 0 ? dying : null,
    jeopardy: jeopardyOf(u),
  };
}

/** Project a run into the dossier's display rows + party summary (pure). */
export function projectDossier(run: RunState): DossierProjection {
  const members = run.party.map(memberRow);
  const alive = run.party.filter((u) => u.alive);
  const stock: StockLine[] = STOCK_ITEMS.map((id) => ({
    id,
    name: getMaterial(id)?.name ?? id,
    count: countOf(run.inventory, id),
  }));
  return {
    members,
    party: {
      morale: run.camp.morale,
      moraleLabel: moraleTier(run.camp.morale),
      upkeep: computeUpkeep(run.party).total,
      hpDeficit: alive.reduce((s, u) => s + Math.max(0, u.maxHp - u.hp), 0),
      woundedCount: alive.filter((u) => u.hp < u.maxHp).length,
      jeopardyCount: members.filter((m) => m.jeopardy != null && m.jeopardy !== "critical").length,
      storageUsed: slotsUsed(run.inventory),
      storageCap: run.inventory.storageCap,
      stock,
      rp: run.rp,
    },
  };
}

/** Total members needing the player's eye (any non-null jeopardy) — the badge count. */
export function attentionCount(proj: DossierProjection): number {
  return proj.members.filter((m) => m.jeopardy != null).length;
}
