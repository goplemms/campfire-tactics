# Guide — Adding a new class (job)

> Audience: anyone adding a playable class or an enemy archetype. Assumes the
> codebase after the **JobId** pass (jobs are data, `jobId` is a type-checked
> union). Design rationale lives in [`docs/design/`](../design/); this is the
> *how-to*. For adding *abilities* to an existing class, see
> [`adding-abilities.md`](./adding-abilities.md).

A class is **data**, not a subclass (decisions **D3/D4/D38/D39/D40**): a
[`JobDef`](../../src/core/jobs.ts) is a named bundle of skills, a baseline stat
frame, per-level growth weights, and an optional identity passive. Adding one is
adding a record — and since the `jobId` field is keyed to a `JobId` union derived
from the registry, **the compiler walks you through the rest**: a typo or a
missing registration is a build error, not a silently job-less unit.

## The mental model

```
JOBS registry ──derives──▶ type JobId        (the set of every class id)
   │                           │
   │ a JobDef per class        │ every `jobId`/`primaryJob`/`heldJobs` field
   ▼                           ▼ is typed to it — unregistered ids don't compile
JobDef { id, skills, baseline, growth, passives?, restPoints?, … }
   │            │         │        │         │
   │            │         │        │         └▶ combat reads passives (PASSIVE keys)
   │            │         │        └▶ leveling banks +1-all + these weights / level
   │            │         └▶ the stat frame the primary class sets (member()/leveling)
   │            └▶ SkillDef[] — the verbs (see adding-abilities.md)
   └▶ JOB_COLORS (render) is Record<JobId, …> — a missing colour won't compile
```

- A **job** lives in [`src/core/jobs.ts`](../../src/core/jobs.ts): the `JobDef`,
  plus an entry in the `JOBS` record. `JobId = keyof typeof JOBS`, so registering
  the class is what makes its id a legal `jobId` everywhere.
- **Stats** ride on the `JobDef`: `baseline` (the frame) and `growth` (per
  job-level weighting; the universal +1-to-all floor is automatic — see
  [`leveling.ts`](../../src/core/leveling.ts)).
- **Identity** is the optional `passives` block, keyed by `PASSIVE`
  ([`combat.ts`](../../src/core/combat.ts)) and stamped on the bearer at battle
  setup by `stampPassives` ([`jobs.ts`](../../src/core/jobs.ts)).
- The **render layer** only needs a token-ring colour; it owns no class rules.

---

## Path A — a new playable class (data-only, compiler-guided)

**1. Define the `JobDef` and register it** in `jobs.ts`. Use a **literal key** in
`JOBS` (not `[SEER.id]`) so the key survives into the `JobId` type:

```ts
export const SEER: JobDef = {
  id: "seer",
  name: "Seer",
  description: "Foretelling support: reads the field and wards the line.",
  passives: { [PASSIVE.triage]: 0.5 },          // optional identity anchor
  baseline: { speed: 10, maxHp: 22, attack: 6, defense: 2, moveRange: 4, sightRadius: 6, attackRange: 1 },
  growth: { maxHp: 2, sightRadius: 1 },          // per job-level, atop the +1-all floor
  restPoints: 2,                                  // support roles bank RP at night (D9)
  skills: [ /* SkillDefs — see adding-abilities.md */ ],
};

export const JOBS = {
  // …existing…
  seer: SEER,                                     // ← literal key; JobId now includes "seer"
} satisfies Record<string, JobDef>;
```

The moment you add `seer:` to `JOBS`, `JobId` includes `"seer"` — and every
unregistered call site that needs it lights up.

**2. Give it a token-ring colour.** `JOB_COLORS`
([`roles.ts`](../../src/game/roles.ts)) is a **total** `Record<JobId, number>`, so
this is now a *compile error until you add it*:

```ts
// src/game/theme.ts — add an identity hue if none fits:
export const ROLE = { /* … */ seer: 0x9b8fe0 } as const;
// src/game/roles.ts — JOB_COLORS:
seer: ROLE.seer,
```

Colours stay render-side on purpose (core never imports the render layer).

**3. Field it.** Put the class on a roster so it actually plays:
- The authored party derives stats from `baseline` automatically via `member()`
  in [`hollow-mill.ts`](../../src/core/hollow-mill.ts) — just add a `member("…",
  "…", "seer")` row.
- If it should be **hireable**, add its id to the recruitable pool in
  `rollMercenary` ([`guild.ts`](../../src/core/guild.ts)).

**4. (Enemy mirror, optional.)** For a foe version, add an `EnemyTemplate` to
`BANDIT_TEMPLATES`/`ENEMY_TEMPLATES` in
[`generation.ts`](../../src/core/generation.ts); set its `jobId` to grant the
class's abilities (e.g. the Snare-Trapper). The template's `jobId` is typed to
`JobId`, so it can't drift from the registry.

**5. Test + build.** `getJob("seer")` loads; `registerParty` buckets its skills;
`npm test` + `npm run build`.

---

## Path B — a new *identity passive*

If the class's signature can't be expressed by an existing passive, add one. This
touches **two** places: the `PASSIVE` key set and its read-site in resolution.

1. **Name it** in `PASSIVE` ([`combat.ts`](../../src/core/combat.ts)) and put its
   magnitude on the `JobDef.passives` block (data, so a balance pass is a number
   edit — and reachable from [`tuning.ts`](../../src/core/tuning.ts) if you add it
   to a tuning block).
2. **Read it** where it applies — combat resolution (`combat.ts`), a skill
   resolver (`skills.ts`), or the AI (`ai.ts`). Reuse `applyDamage`/`applyStatus`
   so events still fire.
3. **Test** the passive's effect in the relevant `*.test.ts`.

---

## Gotchas & conventions

- **Register with a literal key.** `seer: SEER`, not `[SEER.id]: SEER` — the
  literal is what `JobId` reads. (`satisfies` still type-checks each value.)
- **`jobId` is type-checked.** A typo (`"heavy_knight"`) won't compile. If you're
  writing a test helper that takes a job id, type its parameter `JobId`, not
  `string` (see `member` in `upkeep.test.ts`, `at` in `kits.test.ts`).
- **Two demo rosters still inline their stats.** `GuildScene.freshGuild` and
  `debug-battle.ts` predate `baseline` and hardcode stat blocks. If your class
  belongs in the guild starting roster, add it there too — and consider deriving
  from `getJob().baseline` rather than re-inlining (a known cleanup).
- **No `noncombat` flag** (D38): any class can take the field — `combatRoster` is
  just `activeRoster`, and nothing reads a non-combat flag (it was removed). Use
  `restPoints`/`upkeep` for a support role's camp economy; a future fielding gate
  can return as a keyword tag rather than a bucket.
- **Identity colour ≠ side colour.** The token *fill* stays side-coloured (gold
  ally / red foe); `roleColor` only recolours the *ring*. Enemies without a job
  fall back to the `FOE_COLORS` name-regex.
- **Keep `core/` pure.** Stats, passives, and growth are data in `core/`; only the
  ring colour lives in the render layer.

## The registration checklist

| Step | File | Compiler-enforced? |
|---|---|---|
| `JobDef` + `JOBS` entry (literal key) | `src/core/jobs.ts` | — (this *defines* `JobId`) |
| `baseline` + `growth` on the def | `src/core/jobs.ts` | — |
| Token-ring colour | `src/game/theme.ts` `ROLE`, `src/game/roles.ts` `JOB_COLORS` | ✅ `Record<JobId,…>` |
| Identity passive (optional) | `src/core/combat.ts` `PASSIVE` + read-site | partial |
| Put it on a roster | `src/core/hollow-mill.ts` (auto-stats) / `GuildScene` / `debug-battle` | — |
| Hireable pool (optional) | `src/core/guild.ts` `rollMercenary` | ✅ `JobId[]` |
| Enemy mirror (optional) | `src/core/generation.ts` templates | ✅ `jobId: JobId` |
| Test | `src/core/jobs.test.ts` | — |
