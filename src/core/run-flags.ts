/**
 * **The known `run.flags` (D52/D119) — the run-scoped boolean bag, made enumerable.**
 *
 * `RunState.flags` is an untyped `Record<string, boolean>`, so a **misspelled flag fails
 * silently**: the zone filter (`buildSpawnZones`) drops a gated zone when its `requiresFlag` is
 * unset, and an unset flag and a *typo'd* flag are indistinguishable at that seam. That is fine
 * for content (which references exported constants) and lethal for a **tool** that takes a flag
 * name as input — a dev tool which silently boots the wrong state is worse than one that
 * refuses. This module is the authoritative list, so a tool can *offer* the flags as a choice
 * and {@link assertKnownRunFlags} can refuse an unknown one.
 *
 * **Three flag namespaces exist; this is only the first.** Do not conflate them:
 *  - **`run.flags`** (here) — run-scoped, written *only* by `AuthoredEncounter.grants[].flag`
 *    (`applyGrant`), read by the `flagSet` predicate, `MapNode.blockedWhen` access, and the
 *    `requiresFlag` spawn-zone gate.
 *  - **`unit.memory`** — *per-unit* recollections (`remember`/`recalls`), e.g. the
 *    `thieves-guild-invite` that gates the Scout→Thief promotion. Not a run flag.
 *  - **`OverworldState` node flags** — the overworld economy's primed/consumed markers
 *    (`primeFlag`/`consumeFlag`, e.g. `DEAL_PRIMED_FLAG`). Not a run flag.
 *
 * ⚠️ **Setting a run flag is NOT inert.** `scoreArrival` folds the count of set flags into its
 * **relics/build-progress magnitude** (`(setFlags + relicItems) / RELICS_REF`), the arrivals
 * dossier lists the set keys, and `terminalDigest` (feasibility) puts them in its signature. So
 * toggling one from a tool nudges the arrivals band — deliberate to document, not to "fix".
 *
 * **Deliberately NOT wired into staging.** `stageEncounter` / `buildSpawnZones` keep accepting
 * any bag: they are handed `run.flags` wholesale, repro dumps restore arbitrary bags, and making
 * them throw would change shipped resolution behaviour for a validation concern that belongs at
 * the *tool's* input boundary. Call {@link assertKnownRunFlags} where a **human or a URL** names
 * a flag, not in the engine.
 *
 * Pure data + pure functions: no Phaser, no DOM, no `Math.random`.
 */

/**
 * One known run flag (a D114 registry record — `*Def`, keyed off its own `.id`).
 *
 * `setBy` / `readBy` are documentation with a job: a tool showing a flag should be able to say
 * what turning it on actually changes, and a flag nothing reads is worth knowing about before you
 * spend a launch on it.
 */
export interface RunFlagDef {
  /** The literal key in `run.flags`. */
  id: string;
  /** Short label for a picker row. */
  label: string;
  /** What it represents in the fiction. */
  description: string;
  /** What sets it in shipped content (the provenance). */
  setBy: string;
  /** What gates on it in shipped content — or how it is *only* observed, if nothing gates. */
  readBy: string;
}

/**
 * The flags shipped content actually uses. Ids are **literals on purpose**: the constants live
 * beside their content (`SIDE_DOOR_INTEL` in `the-rescue.ts`), and importing that here would drag
 * its module-load `registerExpedition` side effect into everything that touches a flag. The
 * constants are pinned against these literals in `run-flags.test.ts` instead — the same
 * "pin the value against the constant in a test" move `AuthoredSpawnZone.requiresFlag` asks for.
 */
const FLAGS: RunFlagDef[] = [
  {
    id: "side-door-intel",
    label: "Side-door intel",
    description:
      "The party scouted the wall patrol and knows the prison's side entrance — the finale's second deploy zone.",
    setBy: 'the `sideDoor` node\'s authored grant (`the-side-door.json` → `grants: { flag: "side-door-intel" }`)',
    readBy:
      "the finale's flag-gated spawn zone (`the-rescue.json` → `spawnZones[].requiresFlag`), unioned in by `buildSpawnZones`",
  },
  {
    id: "medic-freed",
    label: "Medic freed",
    description: "Sela the Medic was freed from the Hollow Mill's holding pen and joined the party.",
    setBy: "the Hollow Mill's captive-pen encounter grant (`hollow-mill.ts`, alongside the `SELA_MEDIC` recruit)",
    readBy:
      "⚠️ nothing gates on it in shipped content — it is a build-progress marker, observable only via the arrivals dossier + relics magnitude. Setting it changes no access.",
  },
];

/**
 * Build the registry, keyed off each record's own `.id` (D114 — never a hand-duplicated literal).
 * Fails loud at load on a duplicate id or an empty id.
 */
export function registerRunFlags(defs: readonly RunFlagDef[]): Record<string, RunFlagDef> {
  // **Null prototype, deliberately.** A flag id is arbitrary caller input, and on a normal object
  // `"toString" in obj` is `true` while `obj["toString"]` hands back `Object.prototype.toString`
  // *typed as a `RunFlagDef`* — so a lookup miss would read as a hit and the validator would wave
  // through a flag that does not exist. A prototype-less map has no inherited keys to confuse.
  const out: Record<string, RunFlagDef> = Object.create(null);
  for (const def of defs) {
    if (!def.id) throw new Error("RUN_FLAGS: a flag has an empty id");
    if (out[def.id]) throw new Error(`RUN_FLAGS: duplicate flag id "${def.id}"`);
    out[def.id] = def;
  }
  return out;
}

/** The known run flags by id. */
export const RUN_FLAGS: Record<string, RunFlagDef> = registerRunFlags(FLAGS);

/** Look up a known run flag; `undefined` on a miss (D114 registry shape). */
export function getRunFlag(id: string): RunFlagDef | undefined {
  return RUN_FLAGS[id];
}

/** The known flag ids, in registry order — a picker's rows. */
export function runFlagIds(): string[] {
  return Object.keys(RUN_FLAGS);
}

/** Whether `id` is a known run flag. */
export function isKnownRunFlag(id: string): boolean {
  return id in RUN_FLAGS;
}

/**
 * **Fail loud on an unknown flag name** — the guard a tool calls on human/URL input.
 *
 * Reports *every* unknown key at once (not just the first) and lists what was available, because
 * the failure this exists to prevent is a near-miss spelling that would otherwise boot a
 * plausible-looking run with a silently absent zone.
 */
export function assertKnownRunFlags(flags: Readonly<Record<string, boolean>>, context = "run flags"): void {
  const unknown = Object.keys(flags).filter((k) => !isKnownRunFlag(k));
  if (unknown.length === 0) return;
  throw new Error(
    `${context}: unknown flag${unknown.length > 1 ? "s" : ""} ${unknown.map((u) => `"${u}"`).join(", ")} ` +
      `(known: ${runFlagIds().join(", ")})`,
  );
}

/**
 * Build a validated flag bag from the ids a tool wants **set** — the launcher's lever, and the
 * one call site that turns a choice into `StageOptions.flags`. Throws on an unknown id
 * ({@link assertKnownRunFlags}) rather than returning a bag that quietly does nothing.
 *
 * Only *set* flags are listed: an absent key and `false` are the same to every reader
 * (`flags[z.requiresFlag] === true`), so there is nothing to represent for a flag left off.
 */
export function runFlagBag(setIds: readonly string[], context = "run flags"): Record<string, boolean> {
  const bag: Record<string, boolean> = {};
  for (const id of setIds) bag[id] = true;
  assertKnownRunFlags(bag, context);
  return bag;
}
