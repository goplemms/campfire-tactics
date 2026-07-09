# Guide — Adding a new status (with teeth)

> Audience: anyone adding a combat status. Assumes the codebase at **M12** (the
> status set with teeth, the `kind` classifier, the visual-tracker registry).
> Design rationale lives in [`docs/design/`](../design/) and decision **D41**;
> this guide is the *how-to*, mirroring [`adding-abilities.md`](adding-abilities.md).

Statuses are **data** (decisions **D4/D41**), not subclasses. A status only has
**teeth** when exactly one consuming system reads it. Cross-cutting consumers
(cleanse, Deadeye, the render tracker tint) read the **`kind` classifier**, never
an id list — so a new status is *one record + one read-hook*, and cleanse /
Deadeye / the tracker need **zero** edits.

## The mental model

```
StatusInstance ──has──▶ id + name + duration + kind:"debuff"|"buff" + data
   │                                  │
   │ applyStatus(unit, ...)           │ exactly ONE system reads it (the "teeth"):
   ▼                                  ▼
unit.statuses[]              CT      → clock.effectiveSpeed   (Slowed / Hastened)
tickStatuses(unit)           damage  → combat.computeDamage   (Exposed / Guarded)
(on the unit's turn start)    move    → combat.effectiveMove   (Swift)
                              turn/AI → ai.ts / turn.ts        (Immobilized)
```

### The status set today (`status.ts`)

| Status | `kind` | Teeth (the one reader) | Builder |
|---|---|---|---|
| Immobilized | debuff | `ai`/`turn` (`isImmobilized`) | `immobilized(d)` |
| Slowed | debuff | `clock.effectiveSpeed` (speed cap; tarpit → 1) | `slowed(d, speed?)` |
| Exposed | debuff | `combat.computeDamage` (+damage) | `exposed(d, amt?)` |
| Hastened | buff | `clock.effectiveSpeed` (+speed) | `hastened(d, amt?)` |
| Guarded | buff | `combat.computeDamage` (−damage) | `guarded(d?, amt?)` |
| Swift | buff | `combat.effectiveMove` (+move, one turn) | `swift(d?, amt?)` |

The numeric magnitude lives in `data.amount`; read it with
`statusAmount(unit, id)`. Tuning constants are `STATUS_TUNING` (and
`CHANNEL_TUNING` for the Mark Prey channel).

---

## The recipe (up to 4 small parts)

### 1) Data — the record + builder

Add an id constant, a `kind`, and a builder that puts the magnitude in
`data.amount` (cf. `exposed`):

```ts
// in src/core/status.ts
export const POISON = "poison";
export function poison(duration: number, amount = 3): StatusInstance {
  return { id: POISON, name: "Poison", duration, kind: "debuff", data: { amount } };
}
```

### 2) Teeth — exactly one consuming system reads it

Pick the single system the status affects and add the read **there only** — do
not scatter reads. Poison ticks at turn-start, so the hook is `tickStatuses`
(turn-start/DoT). Damage statuses go in `combat.computeDamage`; CT statuses in
`clock.effectiveSpeed`; movement in `combat.effectiveMove`; targeting in `ai.ts`.

```ts
// the DoT read belongs with the turn-start tick (status.ts/tickStatuses or a
// turn.ts turn-start hook) — apply statusAmount(unit, POISON) via applyDamage.
```

### 3) Cross-cutting consumers — free, because they read `kind`

Because you set `kind: "debuff"`, **with zero further edits**:

- `cleanseOne(unit)` (the Medic's antidote) can already remove your status,
- `isDebuffed(unit)` (the Hunter's Deadeye, read in `computeDamage`) already
  punishes a target carrying it,
- the core status→visual registry (`STATUS_VISUALS` in `status.ts`) already
  tints/badges it as a debuff.

This is the maintenance win the classifier buys (D41).

### 4) Aura vs duration

- **Duration** statuses decay via `tickStatuses` on the bearer's turn start.
- **Aura-maintained** statuses (the Heavy Knight's tarpit Slowed) are
  re-applied/cleared each time positions change by the emitting system — see
  `combat.refreshAuras`, which tags its Slowed with `data.aura: "tarpit"` so it
  only ever adds/removes *its own* instance.

### 5) Test it

In `status.test.ts` / `status-teeth.test.ts`: apply → assert the **one** reader
changes a decision → `cleanseOne` removes it (if a debuff).

---

## Render — the visual tracker (required, D41)

Every status needs an at-a-glance indicator on the unit token (icon/badge + tint
+ hover tooltip) so the board reads without clicking. This is **data**, and it now
lives in **core**: add one entry to the `STATUS_VISUALS` registry (`id → { glyph,
tint, label }`) in [`status.ts`](../../src/core/status.ts) (read via `statusVisual`),
consumed by the render's [`unit-readout.ts`](../../src/game/unit-readout.ts) and
`combat-view.ts`. A new status gets a tracker by adding a registry row, not bespoke
draw code. (Glyph + tint are plain data — no Phaser — so the registry stays core-pure.)

## Gotchas & conventions

- **Tick timing.** Statuses tick on the *bearer's* turn start
  (`Battle.nextActor`), so a 1-turn lockout needs `duration: 2` to survive that
  tick (cf. Immobilized from Hamstring).
- **One reader.** If two systems need to branch on a status, prefer the `kind`
  classifier for the cross-cutting one; keep the bespoke magnitude in a single
  reader.
- **Magnitude in `data.amount`.** Use `statusAmount`; don't invent per-status
  fields the cross-cutting readers won't know about.
- **Keep `core/` pure.** No Phaser/DOM in `src/core`. The tracker visuals live in
  the scene; the rules live in core.

## File map

| Concern | File |
|---|---|
| Status records, builders, classifier, cleanse/Deadeye reads | `src/core/status.ts` |
| CT teeth (Slowed/Hastened) | `src/core/clock.ts` (`effectiveSpeed`) |
| Damage/move teeth (Exposed/Guarded/Swift) + the tarpit aura | `src/core/combat.ts` |
| Targeting teeth (Immobilized) | `src/core/ai.ts`, `src/core/turn.ts` |
| Visual trackers (`STATUS_VISUALS`, `statusVisual`) | `src/core/status.ts` (consumed by `src/game/unit-readout.ts`, `combat-view.ts`) |
| Tests | `src/core/status*.test.ts` |
