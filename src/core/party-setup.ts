/**
 * **Party setup** — the "this party, but…" layer every encounter-start tool shares.
 *
 * A test fight starts from *some* party: a playtest kit, the party a route arrives with, a
 * scenario's roster. Working back from the finale needs one more lever on top of whichever it is:
 * "the same people, at level 5", "Rook at full health with the wayfarer blade". This module is that
 * lever, as plain serialisable data ({@link PartySetup}) and one function that applies it to a live
 * party ({@link applyPartySetup}) — so the editor's Launch tab, the `#launch` link and the headless
 * level sweep can never disagree about what "level 5" means.
 *
 * Levelling goes through {@link setUnitLevel}, the real growth rules, so a raised body is the body
 * the campaign would have grown. Fail-loud on anything that would otherwise do nothing quietly: an
 * unknown unit id, an unknown item, a level or HP percentage out of range. A dev tool that silently
 * ignores half its input misreports the state it claims to reach.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import { getEquipment } from "./equipment";
import { setUnitLevel } from "./leveling";
import type { EquipSlot, Unit, UnitEquipment, UnitStats } from "./units";

/** Per-unit adjustments, layered on top of the party-wide ones. */
export interface UnitTweak {
  /** Character + primary job level (overrides {@link PartySetup.level} for this unit). */
  level?: number;
  /** Starting HP as a percentage of max (1–100); overrides {@link PartySetup.hpPct}. */
  hpPct?: number;
  /** Absolute stat values, applied after levelling (a tougher or faster body). */
  stats?: Partial<UnitStats>;
  /** Slot → item id; an empty string clears the slot. Applied after `stats`. */
  equipment?: Partial<Record<EquipSlot, string>>;
}

/** The party adjustments a test fight starts with. Every field is optional; `{}` changes nothing. */
export interface PartySetup {
  /** Put every unit at exactly this character + primary job level. */
  level?: number;
  /** Every unit's starting HP as a percentage of max (1–100). Unset keeps each unit's HP fraction. */
  hpPct?: number;
  /** Per-unit tweaks by unit id. */
  units?: Record<string, UnitTweak>;
}

/** The highest level the tools accept — far past anything the arc reaches, low enough to catch a typo. */
export const MAX_SETUP_LEVEL = 30;

/** The stat keys a {@link UnitTweak.stats} may set (the {@link UnitStats} block). */
export const TWEAKABLE_STATS: readonly (keyof UnitStats)[] = [
  "speed", "maxHp", "attack", "defense", "moveRange", "sightRadius", "attackRange",
];

const SLOTS: readonly EquipSlot[] = ["weapon", "armor", "accessory"];

/** True when a setup changes nothing (the tools skip the apply and say "as is"). */
export function isEmptySetup(setup: PartySetup): boolean {
  return setup.level === undefined && setup.hpPct === undefined && Object.keys(setup.units ?? {}).length === 0;
}

/**
 * Check a setup against a party without touching it, returning every problem (empty = applicable).
 * {@link applyPartySetup} throws with these; the Launch tab shows them before the click.
 */
export function partySetupIssues(party: readonly Unit[], setup: PartySetup): string[] {
  const issues: string[] = [];
  const checkLevel = (lv: number | undefined, where: string) => {
    if (lv !== undefined && (!Number.isInteger(lv) || lv < 1 || lv > MAX_SETUP_LEVEL)) {
      issues.push(`${where}level must be a whole number 1–${MAX_SETUP_LEVEL}, got ${lv}`);
    }
  };
  const checkHp = (pct: number | undefined, where: string) => {
    if (pct !== undefined && (!Number.isFinite(pct) || pct < 1 || pct > 100)) {
      issues.push(`${where}HP % must be 1–100, got ${pct}`);
    }
  };
  checkLevel(setup.level, "");
  checkHp(setup.hpPct, "");
  const ids = new Set(party.map((u) => u.id));
  for (const [id, t] of Object.entries(setup.units ?? {})) {
    if (!ids.has(id)) {
      issues.push(`no party unit "${id}" (party: ${[...ids].join(", ") || "none"})`);
      continue;
    }
    checkLevel(t.level, `${id}: `);
    checkHp(t.hpPct, `${id}: `);
    for (const [stat, v] of Object.entries(t.stats ?? {})) {
      if (!TWEAKABLE_STATS.includes(stat as keyof UnitStats)) issues.push(`${id}: unknown stat "${stat}"`);
      else {
        const min = stat === "maxHp" ? 1 : 0;
        if (!Number.isFinite(v) || (v as number) < min) issues.push(`${id}: ${stat} must be a number ≥ ${min}, got ${v}`);
      }
    }
    for (const [slot, item] of Object.entries(t.equipment ?? {})) {
      if (!SLOTS.includes(slot as EquipSlot)) {
        issues.push(`${id}: unknown slot "${slot}" (slots: ${SLOTS.join(", ")})`);
        continue;
      }
      if (!item) continue; // "" clears the slot
      const def = getEquipment(item);
      if (!def) issues.push(`${id}: unknown item "${item}"`);
      else if (def.slot !== slot) issues.push(`${id}: "${item}" goes in the ${def.slot} slot, not ${slot}`);
    }
  }
  return issues;
}

/**
 * Apply a {@link PartySetup} to a live party, in place: level → stats → equipment → HP. Each unit
 * keeps its HP **fraction** through the level change unless an HP percentage is set, so "the
 * arrival party at level 5" still carries the arrival's wounds. Throws listing every problem
 * ({@link partySetupIssues}) before changing anything. Fallen units are left alone.
 */
export function applyPartySetup(party: Unit[], setup: PartySetup): void {
  const issues = partySetupIssues(party, setup);
  if (issues.length > 0) throw new Error(`party setup: ${issues.join("; ")}`);
  for (const unit of party) {
    if (!unit.alive) continue;
    const t = setup.units?.[unit.id] ?? {};
    const fraction = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
    const level = t.level ?? setup.level;
    if (level !== undefined) setUnitLevel(unit, level);
    for (const [stat, v] of Object.entries(t.stats ?? {})) {
      (unit as unknown as Record<string, number>)[stat] = v as number;
    }
    if (t.equipment) {
      const eq: UnitEquipment = { ...unit.equipment };
      for (const [slot, item] of Object.entries(t.equipment)) {
        if (item) eq[slot as EquipSlot] = item;
        else delete eq[slot as EquipSlot];
      }
      unit.equipment = eq;
    }
    const pct = t.hpPct ?? setup.hpPct;
    const target = pct !== undefined ? pct / 100 : fraction;
    unit.hp = Math.max(1, Math.min(unit.maxHp, Math.round(unit.maxHp * target)));
  }
}
