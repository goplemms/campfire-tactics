/**
 * Editor **soft play** (playtest) support — turn a draft {@link AuthoredEncounter} into a
 * live `{ run, loop }` the real {@link "./scenes/BattleScene"} stages, so an author can
 * *functionally* test a level from `#editor` without the export → drop-in-`content/levels/`
 * → reload round-trip. Deploy the squad, watch the AI, feel the spacing — then bounce back
 * to the editor (the `returnTo` handoff) with the draft intact.
 *
 * **Flexible party selection (owner ask).** Some levels are tailored to a specific class or
 * squad, so *which* party you field matters. This is a small **registry of named playtest
 * squads** ({@link PLAYTEST_KITS}) that the editor surfaces as a picker; its derived
 * {@link PLAYTEST_PARTIES} maps straight onto the scenario harness's existing party matrix
 * ({@link ScenarioConfig.parties}), so adding a squad is one entry here — no new plumbing.
 *
 * **A kit DECLARES its bodies; it is not a bare job list.** The five original squads shared
 * one flat {@link BASE} stat block with only the *job* varying, so nothing could resemble a
 * party that had actually crossed ten layers of an arc — no job levels, no gear, no stats.
 * A {@link KitBody} now carries **job levels** (D39), **equipment** (D76) and **stat
 * overrides**, all of which {@link "../core".createUnit} already passes through, so this is
 * *data*, not machinery. The five original squads declare none of the new fields and derive
 * **byte-identical** specs to the ones they hand-built (pinned in `playtest.test.ts`).
 *
 * Thin glue over the pure core ({@link buildScenarioRun}) — no rules of its own.
 */

import {
  buildScenarioRun,
  getEquipment,
  type AuthoredEncounter,
  type ScenarioConfig,
  type UnitSpec,
  type UnitStats,
  type UnitEquipment,
  type JobId,
  type JobLevel,
  type RunState,
  type RunLoop,
} from "../core";

/** A serviceable all-round stat block — the floor every playtest body starts from. */
const BASE = { speed: 11, maxHp: 26, attack: 8, defense: 3, moveRange: 4, sightRadius: 5, attackRange: 1 } as const;

/**
 * One **body-line** in a kit: a job, how many of it, and what those bodies bring beyond
 * {@link BASE}. Every optional field maps onto a {@link UnitSpec} field `createUnit` already
 * honours — so a kit can describe a levelled, geared body without new plumbing.
 */
export interface KitBody {
  /** The job (and effective primary). Typed against {@link JobId}, so a typo is a compile error. */
  job: JobId;
  /** How many bodies of this job; defaults to 1. Ids number per job in declaration order. */
  count?: number;
  /** Character level (D32); defaults to 1. */
  level?: number;
  /** Per-job levels (D39) — e.g. a Thief that reads as a *promoted* Scout. */
  jobLevels?: Record<string, JobLevel>;
  /** Pre-equipped gear (D76), slot → {@link "../core".EQUIPMENT} id. Validated at load. */
  equipment?: UnitEquipment;
  /** Stat overrides layered on {@link BASE} — a tougher, faster or longer-ranged body. */
  stats?: Partial<UnitStats>;
}

/**
 * An authored playtest kit (a D114 registry record: `*Def`, keyed off its own `.id`).
 *
 * The `id` **is the public handle** — it is the picker's `<option>` value, the
 * `#scene=<id>?party=<name>` parameter, and the key `ScenarioConfig.parties` is looked up by.
 * So it is a display string rather than a slug, and **renaming one is a breaking change**
 * (`e2e-editor-playtest` selects `"Vanguard (5)"` by value).
 */
export interface PartyKitDef {
  id: string;
  bodies: KitBody[];
}

/**
 * The playtest kits, in picker order. **Standard (3)** is the small default (the same
 * soldier/hunter/medic trio `#level=<id>` playtests with); the rest are flavoured squads for
 * levels built around a class or a size — a bigger front line, a mobile skirmish line, an
 * infiltration cell for extraction maps, or a lone body for tight boards.
 *
 * The first five declare **no** new fields on purpose: they are the shipped squads, and their
 * derived specs are pinned byte-identical. New fields are exercised by the probe kit below.
 */
const KITS: PartyKitDef[] = [
  { id: "Standard (3)", bodies: [{ job: "soldier" }, { job: "hunter" }, { job: "medic" }] },
  {
    id: "Vanguard (5)",
    bodies: [{ job: "heavy-knight" }, { job: "soldier" }, { job: "hunter" }, { job: "scout" }, { job: "medic" }],
  },
  { id: "Skirmishers (4)", bodies: [{ job: "scout" }, { job: "hunter", count: 2 }, { job: "medic" }] },
  { id: "Infiltration (3)", bodies: [{ job: "thief" }, { job: "scout" }, { job: "medic" }] },
  { id: "Solo (1)", bodies: [{ job: "soldier" }] },
  {
    // ⚠️ PLACEHOLDER, not canon. The finale's reference party is a separate owner decision
    // (`playtest-launcher-brief.md`: "build the mechanism and ship a sensible placeholder; do
    // not invent canon"). This exists to (a) exercise job levels / equipment / stats and (b) be
    // *able* to play the finale's sneaking route at all.
    //
    // Shape is constrained, not arbitrary:
    //  - a **Thief** is mandatory — `lockpick: true` sits on exactly one job, so nobody else can
    //    open the cells; its `jobLevels` read as a *promoted Scout* (the campaign route to Thief).
    //  - **five** bodies, so the front can field a distraction while one body infiltrates — and
    //    five is also the finale's primary zone's **tile** count. Its authored `cap` is 6, but
    //    placement does not enforce the cap and stacks the overflow onto the last tile, so a
    //    6-body kit would start with two bodies sharing a tile. Sized to the tiles, not the cap.
    id: "Finale probe (5)",
    bodies: [
      {
        job: "thief",
        jobLevels: { scout: { level: 5, xp: 0 }, thief: { level: 2, xp: 0 } },
        stats: { speed: 14, moveRange: 5, sightRadius: 6 },
      },
      { job: "heavy-knight", level: 4, jobLevels: { "heavy-knight": { level: 4, xp: 0 } }, stats: { maxHp: 40, defense: 6 } },
      { job: "soldier", level: 4, jobLevels: { soldier: { level: 4, xp: 0 } }, equipment: { weapon: "wayfarer-blade" }, stats: { maxHp: 32, attack: 11 } },
      { job: "hunter", level: 4, jobLevels: { hunter: { level: 4, xp: 0 } }, stats: { attack: 10, attackRange: 3 } },
      { job: "medic", level: 4, jobLevels: { medic: { level: 4, xp: 0 } }, stats: { maxHp: 24 } },
    ],
  },
];

/** Expand one {@link KitBody} line into its bodies; ids number per job, in declaration order. */
function kitSpecs(kit: PartyKitDef): UnitSpec[] {
  const seq: Record<string, number> = {};
  const out: UnitSpec[] = [];
  for (const b of kit.bodies) {
    for (let i = 0; i < (b.count ?? 1); i++) {
      const n = (seq[b.job] = (seq[b.job] ?? 0) + 1);
      // Optional fields are spread **only when declared**, so the five shipped squads derive
      // specs with exactly the keys they always had (no `jobLevels: undefined` drift).
      out.push({
        id: `test-${b.job}-${n}`,
        side: "player",
        pos: { col: 0, row: 0 },
        jobId: b.job,
        primaryJob: b.job,
        ...BASE,
        ...b.stats,
        ...(b.level !== undefined ? { level: b.level } : {}),
        ...(b.jobLevels ? { jobLevels: b.jobLevels } : {}),
        ...(b.equipment ? { equipment: b.equipment } : {}),
      });
    }
  }
  return out;
}

/**
 * Build the kit registry, keyed off each record's own `.id` (D114 — never a hand-duplicated
 * literal). **Fails loud at load** on a duplicate id, on an empty kit, and on an equipment id
 * that is not in `EQUIPMENT`.
 *
 * The equipment check earns its place: `equipmentDelta` skips an unknown id (`if (!def)
 * continue`), so a misspelled item is **silently worthless** — a kit that looks geared and
 * isn't is exactly the way a dev tool lies to its user. Only registered gear does anything.
 */
export function registerKits(kits: readonly PartyKitDef[]): Record<string, PartyKitDef> {
  // **Null prototype, deliberately.** A kit name is arbitrary caller input (a `?party=` value, a
  // picker string), and on a normal object `parties["toString"]` hands back
  // `Object.prototype.toString` — truthy, so `buildScenarioRun`'s fail-loud "no party" guard would
  // sail past it and then choke further downstream on a function where a roster belongs.
  const out: Record<string, PartyKitDef> = Object.create(null);
  for (const kit of kits) {
    if (out[kit.id]) throw new Error(`PLAYTEST_KITS: duplicate kit id "${kit.id}"`);
    if (kit.bodies.length === 0) throw new Error(`PLAYTEST_KITS: kit "${kit.id}" declares no bodies`);
    for (const b of kit.bodies) {
      if ((b.count ?? 1) < 1) throw new Error(`PLAYTEST_KITS: kit "${kit.id}" body "${b.job}" has count < 1`);
      for (const [slot, id] of Object.entries(b.equipment ?? {})) {
        if (id && !getEquipment(id)) {
          throw new Error(`PLAYTEST_KITS: kit "${kit.id}" body "${b.job}" equips unknown item "${id}" in slot "${slot}"`);
        }
      }
    }
    out[kit.id] = kit;
  }
  return out;
}

/** The playtest kits by id — the declaration the picker and {@link PLAYTEST_PARTIES} derive from. */
export const PLAYTEST_KITS: Record<string, PartyKitDef> = registerKits(KITS);

/** Look up a kit by id; `undefined` on a miss (D114 registry shape). */
export function getPartyKit(id: string): PartyKitDef | undefined {
  return PLAYTEST_KITS[id];
}

/**
 * The named squads as `ScenarioConfig.parties` wants them — **derived** from
 * {@link PLAYTEST_KITS}, not hand-written. Keeping this shape is what leaves every existing
 * consumer (the editor picker, `#scene=…?party=`, `#level`) untouched.
 */
export const PLAYTEST_PARTIES: Record<string, UnitSpec[]> = Object.assign(
  Object.create(null) as Record<string, UnitSpec[]>, // prototype-less, for the reason registerKits gives
  Object.fromEntries(Object.values(PLAYTEST_KITS).map((kit) => [kit.id, kitSpecs(kit)])),
);

/** The squad fielded when the author hasn't chosen otherwise — a small, standard trio. */
export const DEFAULT_PLAYTEST_PARTY = "Standard (3)";

/** The playtest squad names, in registry order — the editor's picker options. */
export function playtestPartyNames(): string[] {
  return Object.keys(PLAYTEST_PARTIES);
}

/**
 * Wrap an encounter as a scenario whose party matrix is the full playtest registry.
 *
 * `seed` is optional and threads straight onto {@link ScenarioConfig.seed} (the encounter's RNG);
 * omitted ⇒ the deterministic `0` floor `buildScenarioRun` already defaults to, so every existing
 * caller is unchanged.
 */
export function playtestScenario(enc: AuthoredEncounter, seed?: string | number): ScenarioConfig {
  return {
    id: enc.id,
    name: enc.name,
    encounter: enc,
    parties: PLAYTEST_PARTIES,
    defaultParty: DEFAULT_PLAYTEST_PARTY,
    ...(seed !== undefined ? { seed } : {}),
  };
}

/**
 * Build the `{ run, loop }` for a soft-play of `enc` with the named squad (defaults to the
 * standard trio). Fail-loud on an unknown squad or a malformed encounter (via
 * {@link buildScenarioRun}) — the editor gates on {@link "../content/levels".validateLevel}
 * first, so a genuine throw here means a bug worth surfacing, not a bad paint.
 *
 * `opts.seed` picks the encounter's RNG; `opts.flags` seeds `run.flags` **before** the scene
 * stages, which is what makes a flag-gated spawn zone reachable for a *run-less* encounter boot —
 * `RunLoop.startEncounter` reads `run.flags` at stage time, and a scenario run has no route that
 * could have earned one. Validate the ids with `runFlagBag` before calling; this just applies them.
 */
export function buildPlaytest(
  enc: AuthoredEncounter,
  partyName: string = DEFAULT_PLAYTEST_PARTY,
  opts: { seed?: string | number; flags?: Record<string, boolean> } = {},
): { run: RunState; loop: RunLoop } {
  const built = buildScenarioRun(playtestScenario(enc, opts.seed), partyName);
  if (opts.flags) Object.assign(built.run.flags, opts.flags);
  return built;
}
