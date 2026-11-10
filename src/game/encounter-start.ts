/**
 * **Encounter start** — everything a test fight starts from, as one plain value: *which* fight
 * ({@link LaunchTarget}), *which* party (a playtest kit, or the party a route arrives with), the run
 * flags, the seed, and the "this party, but…" adjustments ({@link PartySetup}: level, HP, per-unit
 * stats and gear).
 *
 * One value, three readers, so they can never disagree:
 *  - the editor's **Launch tab** builds one from its controls;
 *  - the **`#launch?…` link** parses one from the URL ({@link parseEncounterStart}), so a setup can be
 *    bookmarked, pasted into a bug report, or booted by an e2e without clicking through the editor;
 *  - {@link buildEncounterStart} turns either into the live `{ run, loop }` the BattleScene stages.
 *
 * The headless twin is `core/level-sweep.ts`, which applies the same {@link PartySetup} to a
 * positioned run (core can't import this module's kits).
 *
 * Thin glue over the core: no Phaser, no DOM, no rules of its own.
 */

import {
  applyPartySetup,
  runFlagBag,
  traverseRoute,
  TWEAKABLE_STATS,
  type EquipSlot,
  type PartySetup,
  type RunLoop,
  type RunState,
  type UnitTweak,
} from "../core";
import { resolveLaunchTarget, type LaunchTarget, type ResolveOpts } from "./launch-target";
import { buildPlaytest, DEFAULT_PLAYTEST_PARTY } from "./playtest";

/** Everything a test fight starts from. Plain and serialisable — see {@link encounterStartQuery}. */
export interface EncounterStart {
  target: LaunchTarget;
  /** The playtest kit for a draft or level target. A node target fields the party its route arrives with. */
  kit: string;
  /** Run-flag ids to force on before the fight stages. */
  flags: string[];
  /**
   * Blank = the deterministic default. A draft/level takes any string (the encounter's seed); a node
   * takes a **whole number**, the route salt `traverseRoute` re-seeds the walk with.
   */
  seed: string;
  /** Party adjustments applied after the party is built (and, for a node, after the walk). */
  party: PartySetup;
}

/** A fresh start: the draft, the default kit, nothing forced. */
export function defaultEncounterStart(): EncounterStart {
  return { target: { kind: "draft" }, kit: DEFAULT_PLAYTEST_PARTY, flags: [], seed: "", party: {} };
}

// --- Target keys ------------------------------------------------------------

/** A target as one string (`draft` · `level:<id>` · `node:<expedition>:<node>`) — the picker value and the link's `target`. */
export function launchTargetKey(t: LaunchTarget): string {
  if (t.kind === "draft") return "draft";
  if (t.kind === "level") return `level:${t.levelId}`;
  return `node:${t.expeditionId}:${t.nodeId}`;
}

/** Parse a {@link launchTargetKey} back; `undefined` when it isn't one. A node's route rides separately. */
export function parseLaunchTargetKey(key: string): LaunchTarget | undefined {
  if (key === "draft") return { kind: "draft" };
  if (key.startsWith("level:") && key.length > "level:".length) return { kind: "level", levelId: key.slice("level:".length) };
  if (key.startsWith("node:")) {
    const [, expeditionId, nodeId, ...rest] = key.split(":");
    if (expeditionId && nodeId && rest.length === 0) return { kind: "node", expeditionId, nodeId };
  }
  return undefined;
}

// --- Per-unit tweak text ----------------------------------------------------

const SLOT_FIELDS: readonly EquipSlot[] = ["weapon", "armor", "accessory"];

/**
 * The per-unit tweak text both the Launch tab's field and the link use: `unit.field=value` entries
 * separated by `;` or new lines — `rook.level=7; rook.weapon=wayfarer-blade; edrin.hp=50;
 * vale.speed=16`. Fields: `level`, `hp` (a percentage), a slot (`weapon`/`armor`/`accessory`; an
 * empty value clears it) or a stat. Throws naming the entry on a malformed one; whether the unit
 * and item exist is checked against the party at launch ({@link applyPartySetup}).
 */
export function parseUnitTweaks(text: string): Record<string, UnitTweak> {
  const out: Record<string, UnitTweak> = {};
  for (const raw of text.split(/[;\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const m = entry.match(/^([\w-]+)\.([A-Za-z]+)\s*=\s*(.*)$/);
    if (!m) throw new Error(`tweak "${entry}": expected unit.field=value (e.g. rook.level=7)`);
    const [, id, field, value] = m;
    const t = (out[id] ??= {});
    if ((SLOT_FIELDS as readonly string[]).includes(field)) {
      t.equipment = { ...t.equipment, [field]: value.trim() };
      continue;
    }
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) throw new Error(`tweak "${entry}": ${field} needs a number`);
    if (field === "level") t.level = n;
    else if (field === "hp") t.hpPct = n;
    else if ((TWEAKABLE_STATS as readonly string[]).includes(field)) t.stats = { ...t.stats, [field]: n };
    else {
      throw new Error(
        `tweak "${entry}": unknown field "${field}" (level, hp, ${SLOT_FIELDS.join(", ")}, ${TWEAKABLE_STATS.join(", ")})`,
      );
    }
  }
  return out;
}

/** The inverse of {@link parseUnitTweaks} — `rook.level=7; rook.weapon=wayfarer-blade`. */
export function formatUnitTweaks(units: Record<string, UnitTweak> | undefined): string {
  const parts: string[] = [];
  for (const [id, t] of Object.entries(units ?? {})) {
    if (t.level !== undefined) parts.push(`${id}.level=${t.level}`);
    if (t.hpPct !== undefined) parts.push(`${id}.hp=${t.hpPct}`);
    for (const [stat, v] of Object.entries(t.stats ?? {})) parts.push(`${id}.${stat}=${v}`);
    for (const [slot, item] of Object.entries(t.equipment ?? {})) parts.push(`${id}.${slot}=${item ?? ""}`);
  }
  return parts.join("; ");
}

// --- The link ---------------------------------------------------------------

/**
 * A start as a URL query — `#launch?` + this boots it. Only non-default fields are written, so a
 * plain link stays short: `target=node:hollow-mill:finale&level=5`.
 */
export function encounterStartQuery(s: EncounterStart): string {
  const q = new URLSearchParams();
  q.set("target", launchTargetKey(s.target));
  if (s.target.kind === "node" && s.target.route) q.set("route", s.target.route.join(","));
  if (s.target.kind !== "node" && s.kit !== DEFAULT_PLAYTEST_PARTY) q.set("kit", s.kit);
  if (s.flags.length) q.set("flags", s.flags.join(","));
  if (s.seed.trim()) q.set("seed", s.seed.trim());
  if (s.party.level !== undefined) q.set("level", String(s.party.level));
  if (s.party.hpPct !== undefined) q.set("hp", String(s.party.hpPct));
  const tweaks = formatUnitTweaks(s.party.units);
  if (tweaks) q.set("tweaks", tweaks);
  return q.toString();
}

/** Parse a `#launch?…` query. Throws naming the bad parameter; unknown parameters are refused too (a typo'd lever does nothing quietly otherwise). */
export function parseEncounterStart(query: string): EncounterStart {
  const q = new URLSearchParams(query);
  const known = new Set(["target", "route", "kit", "flags", "seed", "level", "hp", "tweaks"]);
  for (const k of q.keys()) {
    if (!known.has(k)) throw new Error(`#launch: unknown parameter "${k}" (known: ${[...known].join(", ")})`);
  }
  const key = q.get("target");
  if (!key) throw new Error("#launch: missing target (e.g. target=node:hollow-mill:finale or target=level:the-rescue)");
  const target = parseLaunchTargetKey(key);
  if (!target || target.kind === "draft") {
    throw new Error(`#launch: target "${key}" is not a level:<id> or node:<expedition>:<node> (a draft only exists inside the editor)`);
  }
  const route = q.get("route");
  if (route) {
    if (target.kind !== "node") throw new Error("#launch: route only applies to a node target");
    target.route = route.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const num = (name: string): number | undefined => {
    const v = q.get(name);
    if (v === null || v.trim() === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`#launch: ${name} must be a number, got "${v}"`);
    return n;
  };
  const party: PartySetup = {};
  const level = num("level");
  const hp = num("hp");
  if (level !== undefined) party.level = level;
  if (hp !== undefined) party.hpPct = hp;
  const units = parseUnitTweaks(q.get("tweaks") ?? "");
  if (Object.keys(units).length) party.units = units;
  return {
    target,
    kit: q.get("kit") ?? DEFAULT_PLAYTEST_PARTY,
    flags: (q.get("flags") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    seed: q.get("seed") ?? "",
    party,
  };
}

// --- Build ------------------------------------------------------------------

/**
 * Turn a start into the live `{ run, loop }` the BattleScene stages, refusing — with the reason —
 * anything it can't honour: an unlaunchable target, an unknown flag, a node seed that isn't a whole
 * number, a party tweak naming a unit or item that isn't there.
 *
 * A draft or level fields the kit; a node walks its route (predecessors auto-played) and fields the
 * party that arrives. Either way the {@link PartySetup} lands last, on the party that will deploy.
 */
export function buildEncounterStart(
  s: EncounterStart,
  opts: ResolveOpts = {},
): { run: RunState; loop: RunLoop; label: string } {
  const resolved = resolveLaunchTarget(s.target, opts);
  const flags = runFlagBag(s.flags, "launch");
  const seed = s.seed.trim();
  let built: { run: RunState; loop: RunLoop };
  let label: string;
  if (resolved.kind === "encounter") {
    built = buildPlaytest(resolved.encounter, s.kit, { seed: seed || undefined, flags });
    label = `${resolved.label} · ${s.kit}`;
  } else {
    let seedSalt: number | undefined;
    if (seed) {
      seedSalt = Number(seed);
      if (!Number.isInteger(seedSalt)) {
        throw new Error(`a node launch's seed is the route salt and must be a whole number, got "${seed}"`);
      }
    }
    // A node is a POSITIONED RUN: walk the route, then force the flags on before the scene stages
    // (`startEncounter` reads `run.flags` there). The kit is deliberately NOT applied: the route's
    // own party is the point — re-level it with the party setup instead.
    built = traverseRoute(resolved.expedition, resolved.route, { seedSalt });
    Object.assign(built.run.flags, flags);
    label = `${resolved.label} via ${resolved.route.join(" → ")} · arrival party`;
  }
  applyPartySetup(built.run.party, s.party);
  return { ...built, label };
}

/** A compact read of a party setup for the status line — `level 5 · hp 100% · rook.level=7`. */
export function describePartySetup(p: PartySetup): string {
  const bits: string[] = [];
  if (p.level !== undefined) bits.push(`level ${p.level}`);
  if (p.hpPct !== undefined) bits.push(`hp ${p.hpPct}%`);
  const tweaks = formatUnitTweaks(p.units);
  if (tweaks) bits.push(tweaks);
  return bits.length ? bits.join(" · ") : "party as is";
}
