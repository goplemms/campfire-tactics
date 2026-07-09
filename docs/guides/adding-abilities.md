# Guide — Adding a new ability (skill)

> Audience: anyone adding combat or non-combat abilities. Assumes the codebase
> after the **D67/D72 substrate unification** (jobs/skills as data, the game-wide
> `usableContext` surface axis, the effect-handler registries; the old D3 `phase`
> tag on skills is retired). Design rationale lives in [`docs/design/`](../design/);
> this guide is the *how-to*.

Abilities are **data**, not subclasses (decisions **D3/D4/D67**). You almost never
touch the battle loop — you add a record to a job and, *only if* you need a brand
new kind of effect, one entry to a resolver registry. This guide walks both paths.

## The mental model

```
JobDef ──has many──▶ SkillDef ──declares──▶ target + range + spend + effect
   │                                            │
   │ unit.jobId links a unit to its job         │ where it surfaces is READ OFF its
   ▼                                            ▼ shape via skillContexts() (no phase tag)
unitSkills(unit)                         combat/pre-combat → availableSkills(unit, ctx)
(the raw per-job set)                    overworld         → availableActions(run)
```

- A **skill** (`SkillDef` in [`src/core/skills.ts`](../../src/core/skills.ts))
  declares what it **targets**, its **range**, the CT it **spends**, and a
  declarative **effect**. Where it may be used is the **`usableContext`** axis
  (`overworld | guild | pre-combat | combat`); it is normally *derived from the
  skill's shape* by `skillContexts(skill)`, so authors rarely write it — set the
  optional `SkillDef.usableContext` only when the default is wrong (e.g. Dig In is
  `pre-combat`-only). The retired D3 pipeline `phase` field is **gone**.
- A **job** (`JobDef` in [`src/core/jobs.ts`](../../src/core/jobs.ts)) is a named
  list of skills; the records live in the `jobs-data/` content modules. A unit's
  `jobId` links it to one.
- The **render layer** reads skills back per surface — `availableSkills(unit,
  "combat")` for battle, `availableActions(run)` for the overworld camp — and draws
  buttons. It owns no rules; it calls `core` and animates.

### The effect catalogue (today)

Effects are a structured union **partitioned by the interpreter that owns them**
(`skills.ts:301-321`), so where a kind resolves is part of the type, not a comment.

| `effect.kind` | Partition | Surface | Resolved by |
|---|---|---|---|
| `damage` | BattleEffect | combat/pre-combat | `resolveSkill` (`BATTLE_EFFECT_HANDLERS`) |
| `heal` | BattleEffect | combat/pre-combat | `resolveSkill` |
| `status` | BattleEffect | combat/pre-combat | `resolveSkill` |
| `channel` | BattleEffect | combat | `resolveSkill` (Mark Prey) |
| `triage-heal` | BattleEffect | combat/pre-combat | `resolveSkill` |
| `cleanse` | BattleEffect | combat/pre-combat | `resolveSkill` |
| `forced-move` | FieldEffect | combat | `Battle.resolveShove` (needs grid) |
| `cleave` | FieldEffect | combat | `Battle.cleave` (needs roster) |
| `med-heal` | FieldEffect | combat/pre-combat | `Battle.useHeal` → `resolveMedHeal` (herb stash) |
| `guard-allies` | FieldEffect | combat | `Battle.resolveGuardAllies` (Turtle Formation) |
| `morale` | CampEffect | overworld | `applyCampSkill` (Cook, `camp.ts`) |
| `placeTrap` | DeploymentEffect | pre-combat | trap `FieldEntity` (`makeTrap`, `entities.ts`) |
| `openMarket` · `primeDeal` · `provisionMeal` · `survey` · `forage` · `sell` · `borrow` · `engageInterest` · `guardPurse` · `patronize` · `triage` · `buy` | OverworldActionEffect | overworld | `OVERWORLD_EFFECT_HANDLERS` (`overworld-actions.ts`) |

`target` is `self | enemy | ally` for board skills, or `camp | party` for the
non-combat ones. Beyond `target`/`range`/`spend`/`effect`, a `SkillDef` may carry
`cost` (charge/cooldown/material — the CT-clock economy), `usableContext` (surface
override), `unlockLevel` (2nd active at job-L2, D39), `requires` (a `CapabilityId`
gate, e.g. Triage), and `overworldCost` (the two-axis between-nodes pacing/price
menu — `cooldown`/`usesPerNode`/`fatigue`/`gold`/`influence`/`rp`, D72/#113).

---

## Path A — a new ability that reuses an existing effect (data-only)

This is the common case and it's a **one-file change**: add a `SkillDef` to a
job's `skills` array (in its `jobs-data/` module). No core logic, no render
changes — the buttons and resolution already exist.

**Example: give the Soldier a longer-reach "Lunge".**

```ts
// in src/core/jobs-data/combat.ts, inside SOLDIER_JOB.skills:
{
  id: "lunge",
  name: "Lunge",
  description: "A reaching strike (+3 attack) against a foe up to 2 tiles away.",
  target: "enemy",
  range: 2,                     // reuses isValidSkillTarget's range check
  spend: "act",
  effect: { kind: "damage", bonusAttack: 3 },
},
```

That's it. Because its effect shape resolves to the board surface,
`skillContexts` files it under `pre-combat` + `combat`, and
`availableSkills(actor, "combat")` (the projection the battle scene renders) picks
it up as a **Lunge** button automatically; clicking it arms targeting, and
`isValidSkillTarget` enforces the range-2 / enemy rule.

**Checklist for Path A**
1. Add the `SkillDef` to the right job in the matching `jobs-data/` module.
2. Add/extend a test in [`jobs.test.ts`](../../src/core/jobs.test.ts) asserting
   the skill loads and `unitSkills`/`availableSkills` returns it.
3. (If it's a new *resolution* behaviour worth pinning) add a
   [`skills.test.ts`](../../src/core/skills.test.ts) case.
4. `npm test` + `npm run build`. Done.

---

## Path B — a new *kind* of effect (touches a resolver registry)

When the effect can't be expressed by an existing kind, add one. The unions are
**exhaustive over their handler registry** (a mapped type), so adding a kind fails
the build until its handler is written — the compiler walks you through it.

**Example: a battle `drain` — damage a foe and heal the caster for half.**

1. **Declare the effect** in `src/core/skills.ts` and add it to the right
   partition (a board effect goes in `BattleEffect`):

   ```ts
   /** Damage a foe and heal the caster for `leech` fraction of the damage. */
   export interface DrainEffect { kind: "drain"; bonusAttack: number; leech: number; }

   export type BattleEffect =
     | DamageEffect | HealEffect | StatusEffect
     | ChannelEffect | TriageHealEffect | CleanseEffect
     | DrainEffect;          // ← add it
   ```

2. **Resolve it** by adding a handler to the registry that owns the partition.
   `drain` is a `BattleEffect`, so add an entry to `BATTLE_EFFECT_HANDLERS` (same
   file). The mapped type forces it — an unhandled kind won't compile. Reuse
   `resolveAttack`/`applyHeal` so defeat/heal events fire like everything else:

   ```ts
   drain: (effect, { caster, target, bus, units }) => {
     const damage = resolveAttack(caster, target, bus, caster.attack + effect.bonusAttack, units);
     const healed = healUnit(caster, Math.floor(damage * effect.leech), bus, caster);
     return { damage, healed };
   },
   ```

   > For a **FieldEffect** (needs grid/roster/stash) you'd add a `Battle` method
   > in [`turn.ts`](../../src/core/turn.ts) and dispatch to it from `Battle.apply`;
   > for a **CampEffect** you'd add a `case` to `applyCampSkill` in
   > [`camp.ts`](../../src/core/camp.ts); for an **OverworldActionEffect** add a
   > handler to `OVERWORLD_EFFECT_HANDLERS` in
   > [`overworld-actions.ts`](../../src/core/overworld-actions.ts); for a
   > **deployment** placeable, build a `FieldEntity` (see `makeTrap` in
   > [`entities.ts`](../../src/core/entities.ts)).

3. **Add the skill** to a job (Path A), e.g. a "Leech" with
   `effect: { kind: "drain", bonusAttack: 0, leech: 0.5 }`.

4. **Render feedback (optional).** The battle scene already reports
   `outcome.damage` / `outcome.healed`, so a drain shows both with no change. If
   your effect needs *new* visuals, add them there — the scene is the only place
   that may grow.

5. **Test it** in `skills.test.ts` (assert damage dealt + caster healed + events).

**Checklist for Path B**
1. Add the interface to the right partition of the `SkillEffect` union.
2. Handle it in the owning registry/resolver (`BATTLE_EFFECT_HANDLERS` /
   `OVERWORLD_EFFECT_HANDLERS` / `applyCampSkill` / a `Battle` method / an entity
   factory) — reuse `resolveAttack`/`applyHeal`/`applyStatus` + bus events.
3. Add the skill to a job.
4. Add a `skills.test.ts` (or `camp.test.ts` / `overworld-actions.test.ts`) case.
5. `npm test` + `npm run build`.

---

## Adding a whole new job

1. Define a `JobDef` in the matching `jobs-data/` module with its skills, and
   register it in the `JOBS` map in `jobs.ts` with a **literal key** (`newjob:
   NEWJOB`, not `[NEWJOB.id]`) so the id survives into the `JobId` union.
2. Give a unit `jobId: "newjob"` (on a roster — the authored cast in
   [`hollow-mill.ts`](../../src/core/hollow-mill.ts) via `member(...)`, or the
   hireable pool in `guild.ts`). `registerParty`/`stampPassives` handle the rest.
3. Test: `getJob("newjob")` loads, and `unitSkills`/`availableSkills` surface each
   skill under the right context (see `jobs.test.ts`).

See [`adding-a-class.md`](./adding-a-class.md) for the full class recipe (baseline
stats, growth, identity passive, token colour).

---

## How a skill reaches the screen

- **Battle:** `availableSkills(actor, "combat")` → one button per skill.
  `self` skills resolve immediately; targeted skills arm, then a click is
  validated by `isValidSkillTarget` and run via `Battle.useSkill(caster, skill,
  target)` (or `Battle.apply` for the union-variant actions), which resolves the
  effect **and** ends the turn, spending CT per `skill.spend`.
- **Deployment / staging:** `availableSkills(actor, "pre-combat")` surfaces the
  Set-Trap / Dig In / Defend / pre-heal buttons; a `placeTrap` registers a
  `makeTrap` entity at battle start.
- **Overworld camp:** `availableActions(run)` folds every fielded member's
  overworld skills (job skills + the universal Buy / Triage-fallback home) through
  the `checkOverworldCost` gate and returns an `ActionView` per verb (label, actor,
  gate verdict, cost readout) — the one projection every camp surface renders.

To surface a skill in a context nothing renders yet, add a small overlay following
those patterns.

---

## Gotchas & conventions

- **CT cost.** `spend: "act"` costs `ACT_COST` (100), `"move"` costs `MOVE_COST`
  (50) — see [`clock.ts`](../../src/core/clock.ts). Battle skills are normally
  Acts. `Battle.useSkill` ends the turn for you; don't also call `endTurn`.
- **Surface is derived, not tagged.** Don't reach for a `phase` field — it's gone.
  Let `skillContexts` derive the surface from the effect shape; override with
  `usableContext` only for a genuinely single-surface mechanic.
- **Charged skills are combat-only.** A skill with `cost.charge` resolves later on
  the CT clock, so `skillContexts` files it under `combat` whatever its effect.
- **Status tick timing.** Statuses tick on the *target's* turn start, so a 1-turn
  lockout needs `duration: 2` to survive that tick (that's why Debilitating
  Strike's rider is `2`). See [`status.ts`](../../src/core/status.ts).
- **Damage goes through `resolveAttack`/`applyDamage`.** Never mutate `hp`
  directly — use them so `unitDamaged` / `unitDefeated` fire and traps/listeners
  stay consistent.
- **Traps ignore their owner** and fire once; forced entry (D19) triggers them via
  the same `unitEnterTile`. Model new placeables as `FieldEntity` listeners, not
  loop special-cases.
- **Effects resolve in their own partition.** `resolveSkill` throws for a
  non-`BattleEffect` routed to it — the throw is a guard, not a TODO; each
  partition has its own interpreter.
- **Keep `core/` pure.** No Phaser/DOM in `src/core/`. Resolution + math live in
  core; only feedback (tweens, markers, text) lives in the scene.

## File map

| Concern | File |
|---|---|
| Skill defs, effect union + partitions, `skillContexts`, `resolveSkill`, `BATTLE_EFFECT_HANDLERS`, targeting | `src/core/skills.ts` |
| Jobs engine (`JOBS`, `JobId`, `getJob`, `unitSkills`, `stampPassives`) | `src/core/jobs.ts` |
| Job/skill **records** (combat roster · scout line · support/economy + universals) | `src/core/jobs-data/{combat,scout-line,support}.ts` |
| Per-context skill projection (`availableSkills`, `abilityScaleBonus`) | `src/core/leveling.ts` |
| Camp/meta effects (`applyCampSkill`, `applyCampToParty`) | `src/core/camp.ts` |
| Overworld verbs (`availableActions`, `OVERWORLD_EFFECT_HANDLERS`) | `src/core/overworld-actions.ts` |
| Field entities (`makeTrap`, `EntityRegistry`) | `src/core/entities.ts` |
| Damage/heal/defeat + the trigger bus | `src/core/combat.ts`, `src/core/event-bus.ts` |
| Battle orchestration (`Battle.useSkill`/`apply`, field-effect methods) | `src/core/turn.ts` |
| Buttons, targeting UI, animations | `src/game/scenes/BattleScene.ts`, `src/game/scenes/OverworldScene.ts` |
| Tests | `src/core/*.test.ts` |
