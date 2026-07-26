# Kickoff — M3: the guard doctrine (the primary drive + `in-combat` gate + control-room targeting)

> **Status: DESIGN — kickoff for a focused session.** The tag foundations (M1–M2.5) are **built, green,
> and shipping** (PR from `claude/tag-system-foundations-9k29hd`). M3 is the **payoff** — the D108 guard
> doctrine that makes `in-combat` load-bearing — but it's **AI surgery** with a real design fork, so it
> gets its own session. Read this **plus** the parent brief
> [`tag-system-kickoff.md`](tag-system-kickoff.md) (the whole design trail: R1–R3, forks F/G/H, the four
> `/challenge` records) and **D108** in `decisions.md`.

## What already exists (M1–M2.5 — the substrate M3 consumes)

- **The tag surface** (`src/core/tags.ts`): `hasTag(unit, tag, ctx)` over `TAGS`; `in-combat` (derived),
  `non-combatant` + `garrison` (intrinsic). `garrison` is read directly (intrinsic, ctx-less); `in-combat`
  needs a `TagContext`.
- **The real `in-combat`** (`src/core/combat-log.ts` + `Battle`): a stored, replay-safe combat **event
  log** feeds `exchangedDamageSince`; **`battle.tagContext()`** returns the live `TagContext`. Window is
  **`(a's last turnEnd, now]`** — a unit engages on damage **received** since it last finished a turn
  (owner-confirmed; the replay-safe realization).
- **The `keyGate` Act** (`gates.ts` `canKeyGate`/`keyholderOf`/`gateActFor`, `combat-actions.ts`,
  `turn.ts`): a keyholder opens its gate as a logged, replay/undo-safe Act.
- **The key-drive (M2c)** (`ai.ts`): a **walled-off** keyholder converges on and keys its gate — the
  planner already lowers `gateTarget` → `keyGate`|`attackGate` via `AIPlan.gateAct`, decided at plan time.
- **The doctrine harness** (`src/core/scenarios/doctrine-harness.ts` `DOCTRINE_HARNESS`): a 6×3 microcosm —
  a keyed+lever seal (the sole chokepoint), the Warden (`role:"captain"`, `tags:["garrison"]`, seal
  keyholder), a garrison guard (`tags:["garrison"]`), two spawns (infiltrator control-room-side, party
  front). **Not gallery-registered** (M4 wraps it in a `ScenarioConfig` + walker). M3 stages it headlessly.
- **The fail-loud tag guard**: `buildAuthoredEnemies`/`Captives` throw on an unregistered authored tag.

## The doctrine to build (D108, owner-confirmed loop)

The whole garrison (Warden + guards) has ONE drive: **get to the doors** — the Warden **keys** his gate,
the guards **batter** theirs. The player pins some (they become `in-combat` and stop advancing to fight);
the unattached ones keep going for the door. A garrison unit **advancing to the objective takes free
hits by design** — the player pins a guard by *hitting* it. Force-splitting is the tension.

So M3 makes the door-drive **primary** and **`in-combat`-gated**, for `garrison` units only:
- **`AIOptions` gains `tagContext`** — `Battle`/`runPolicyTurn` pass `this.tagContext()` so the planner can
  read `hasTag(unit, IN_COMBAT, ctx)`. (Mirrors the existing `isCharging` closure seam.)
- **`garrison` && `!in-combat`:** the drive to open the nearest seal (key/batter) becomes the **top
  action** — it **outranks attacking a reachable, un-engaged foe** (a new score above `AI.actionBase`
  1000). The Warden pursues the seal *past* the distracting infiltrator, taking free hits.
- **`garrison` && `in-combat`:** fall through to normal scoring — stop and fight the engager.
- **Non-garrison units: byte-identical** (the M2c `wallsOff` batter path untouched).

## THE OPEN FORK — resolve first (owner input needed)

The pre-mortem found `opensARoute` (today's seal-relevance filter, "opening reveals a route to a foe")
**doesn't fit the primary drive**: a garrison unit already has a reachable foe (the infiltrator), so
`opensARoute` is trivially true for *any* gate. Two models to replace it:

- **A — seal-drive (simple).** A garrison `!in-combat` unit drives to the **nearest openable authored
  seal** (the author places seals as the garrison's objective; skip `opensARoute`/`wallsOff` for garrison).
  Directional *by authoring* (place seals between garrison and objective). **Control-room targeting is a
  separate M3b.** *Lean: A + M3b* — smaller, testable now, correct for the harness + the concentric finale.
- **B — objective-advance (unified).** The garrison **advances toward the control-room objective (an
  authored region span), opening any seal en route**, and **prioritizes foes in the control room** (Decision
  G's lever-camp defuser). Directional *by construction*; folds control-room targeting in. **Bigger** —
  the control-room region becomes core plumbing (`AuthoredEncounter` field → staging → `Battle` → planner).

**Decide A+M3b vs B before building.** (Owner lean at hand-off: A + M3b.)

### M3b — control-room targeting (Decision G), if split from A
A garrison unit prefers foes **in the control-room region** as attack targets (a target-priority bonus) —
so a lever-camping infiltrator gets attacked (the Warden "walks through and engages the control room"),
defusing the keyed-gate ↔ lever re-seal oscillation. Needs a **control-room region** on `AuthoredEncounter`
(a tile span) + plumbing to the planner + the harness populated with one. This is where the M2.5-deferred
"control-room region marker" lands.

## The pre-mortem findings (from `/challenge`, carry into build)

- **Blast radius CONTAINED** — every new branch gated on `hasTag(unit, GARRISON)`; generic bandits
  byte-identical. **The `ai.test:90` (prefer-reachable-foe) + C3 canaries MUST stay green.**
- **`opensARoute` breakdown** → the fork above (garrison targets authored seals directly).
- **Score ordering:** `garrison && !in-combat && seal-in-reach` → a new top score (> `actionBase`); else the
  existing `actTarget > gateHit(wallsOff) > post > advance` ladder. Insert the garrison branch cleanly.
- **`in-combat` plumbing is pure** — `tagContext` is a read-only query via opts; no determinism risk.
- **The window subtlety (already resolved):** a garrison unit is `in-combat` only vs a foe it can still
  damage (clause 5) that hit it since its last turnEnd — so ranged plinking from out of reach does NOT pin
  it (owner's H ruling), and it self-clears on the clock (R2).

## Test targets

- **Unit (`ai.test.ts`) against `DOCTRINE_HARNESS`:** a garrison Warden with a reachable infiltrator +
  a seal → `!in-combat` ⇒ plan targets the **seal** (`gateAct` set), not the infiltrator; **`in-combat`**
  (stub the ctx / stage an exchange) ⇒ plan **attacks** the engager. A non-garrison unit in the same spot →
  unchanged. The canaries stay green.
- **Integration (`runPolicyTurn`):** the harness plays a few turns — the garrison converges on and opens the
  seal while un-engaged; a pinned Warden stops and fights.
- **M3b:** a control-room-occupying foe is prioritized as a target.

## Then — the rest of the tag session

- **M4** — the two-spawn distraction **visual e2e**: register `DOCTRINE_HARNESS` as a `ScenarioConfig` in
  the `#scene` gallery + a walker (`scripts/e2e-*.mjs`); assert no freeze + the seal fires when unengaged /
  stays shut when the Warden is pinned + a **free-casualty ceiling** (the ranged-farm tripwire). Then author
  the **D117** decision record (the tag/status delineation, provenances, `in-combat` spec, R1–R3, forks).
- **M5** — the **droppable key** (the specific key-drop reusing the `keyGate` Act; a key field-entity via
  `entities.ts` + minimal pickup), **required before the finale node is finished** (owner). NOT the general
  item system (deferred, D108).
- **Deferred as ever:** the `captured`/`thief`/`lord`/`authored` boolean→tag migration.

## Key files

| Role | File |
| --- | --- |
| The planner to reorder | `src/core/ai.ts` (the door-drive: `driveDoors` ~L325, the per-tile scoring ~L368–392, `AIPlan.gateAct`) |
| in-combat plumbing | `src/core/turn.ts` (`Battle.tagContext`/`runPolicyTurn`), `AIOptions` in `ai.ts` |
| Tag reads | `src/core/tags.ts` (`hasTag`, `GARRISON`, `IN_COMBAT`) |
| The fixture | `src/core/scenarios/doctrine-harness.ts` (`DOCTRINE_HARNESS`) |
| Seal/lower helpers | `src/core/gates.ts` (`canKeyGate`/`keyholderOf`/`gateActFor`), `src/core/battle-replay.ts` (`planActions`) |
| Guards | `src/core/ai.test.ts` (canaries `:90`/C3), `doctrine-harness.test.ts`, `barrel-surface.test.ts` |

## Discipline (every build PR)

Pure `core/` (no `Math.random`/Phaser/DOM); replay-safe; keep all guards green (`build`/`test`/`sim`,
`test:e2e:*` for the M4 render surface). Own decision record (D117). **`/challenge` the chosen model (A/B)
before code** — the score reorder is the exact spot the blast-radius bug would hide. The **finale
population + promotion (the v4 "Rescue")** stays a **separate owner-directed track** (D97–D99, D116) — the
doctrine drops into it when that's built; do NOT author the real finale here.
