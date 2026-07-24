# Tag system — focused-session kickoff prompt (design + minimal build)

**Origin:** surfaced mid-conversation while defining the finale's *special spawn condition* and the
D108 guard doctrine. The doctrine's open crux is **what sets/clears `in-combat`** (the flag that
suppresses a guard from abandoning a fight to batter a slammed seal). Defining `in-combat` well kept
pulling toward a **general tag concept** the whole game can hook on to — so we split it off into its
own focused session rather than smuggle it in under finale cover.

Read this **plus** `decisions.md` **D108** (guard doctrine + `in-combat` as "the first tag-status"),
**D41** (statuses gained a `kind` classifier — the proto-tag), **D116/D99** (the finale flank this
ultimately unblocks), and **D114 + `docs/design/implementation/conventions.md`** (the one-spelling /
registry / living-exemplar / guard-test discipline any new shared structure must follow).

---

## Why this is its own session (the motivation)

The core already carries a **scatter of ad-hoc proto-tags**:
- `src/core/units.ts` — loose per-unit booleans: `isLord`, `authored`, `thief`, `captured`.
- `src/core/status.ts` — the `kind` classifier (`"buff" | "debuff"`, D41) that statuses already carry.
- No general `hasTag` query surface exists today (only informal uses: rider tags, the clock-domain
  type-tag in `cost.ts`, the objective role tag in `authored.ts`).

So a tag system isn't a concept from nothing — it **consolidates those four booleans + the status
`kind` under one queryable surface**. That consolidation is the real prize, and it sits squarely in
the repo's current audit/conventions theme.

---

## The proposed design (our working delineation — do not relitigate the core split; refine within it)

The rule that keeps tags from just becoming "statuses again":

- **Status** = a *stateful, effect-bearing* condition. Has duration/ticks/magnitude; read by
  combat/clock hooks; the mechanical **actor**. (Unchanged — this session does not touch the status
  model's behavior.)
- **Tag** = a *classification / predicate* — a queryable label, **no inherent duration or effect**.
  One query surface, three provenances:
  - **Intrinsic** — authored on the unit/template (`non-combatant`, `boss`, `undead`; the migration
    targets `lord`/`authored`/`thief`/`captured`).
  - **Conferred** — a status stamps a tag **while active** (flanked status → `flanked` tag). A **live
    projection** of the active status, so it clears when the status clears — the status stays the single
    source of truth, no drift.
  - **Derived** — computed from world-state **on query** (`in-combat`, `adjacent-to-ally`). A **pure
    function of battle state**.

**Unified query:** `hasTag(unit, tag, ctx)` unions the three sources; `ctx` (= battle state) feeds the
derived predicates. Stays pure/deterministic — no `Math.random`, no Phaser/DOM (core discipline), and
recomputes from snapshotted state so replay (D22) is unaffected.

**The payoff (the point):** producer and consumer **decouple**. An ability / the AI / an objective hooks
`hasTag(u, "flanked")` and does **not** care whether that came from intrinsic data, an active status, or
a live computation.

---

## Scope — the finale forces a MINIMAL slice; the migration is a follow-on

Build the general **mechanism** + exactly the two tags the finale forces, as the living exemplar:
- **`in-combat`** — derived (spec below).
- **`non-combatant`** — intrinsic (a unit that *can* deal damage but is **deprioritized** as a target —
  not ignored).

**Do NOT, this session:** migrate `captured`/`thief`/`lord`/`authored` onto the tag surface (a separate,
guard-covered follow-on — not a prerequisite); turn tags into a second status engine; add a general
provides/requires-style capability engine. Keep the registry to the tags actually used.

---

## The `in-combat` working spec (from the conversation)

`in-combat(U)` is **true** iff there exists an enemy `E` such that **all** hold:
1. `U` has **dealt damage to** or **received damage from** `E` **since `U`'s last turn (inclusive)**.
2. `E` is **targetable**.
3. `E` is a **combatant** (does **not** hold the `non-combatant` tag).
4. `E` is **within striking distance**.
5. `U` is **still capable of dealing damage to `E`** — `U` has a viable attack against `E` that is not
   nullified (e.g. `E` is not immune to `U`'s damage type). *(R1 refinement — see below.)*

Anchoring the memory window to "since its last turn" is deliberate — it **self-clears on the clock**
instead of needing an arbitrary tick timer. **Proximity alone never triggers `in-combat`** — an
exchange must actually have happened *and* `U` must still be able to fight back.

### Rulings — ratified 2026-07-23 (owner-confirmed)
- **R1 — proximity alone does not engage; the exchange must have happened AND `U` must still be able to
  hurt `E`.** *Not* a straight `OR` with "a foe is adjacent right now." An enemy `U` cannot meaningfully
  damage (immune to `U`'s damage type, or `U` has no viable attack on it) does **not** pin `U` in combat,
  even standing adjacent — `U` stays free to peel to the door. Captured as **clause 5** above; the "free
  first engagement" is intentional, and the guard turns to fight only once blows are actually traded with
  a foe it can still answer.
- **R2 — the Speed-dependent window is a *feature*.** "Since its last turn" is a shorter real-time window
  for a fast unit, longer for a slow one ⇒ **faster units drop out of combat sooner** (re-evaluate more
  often, read as more alert). Accepted as intended; no fixed-duration timer.
- **R3 — `non-combatant` does not confer `in-combat`.** A guard whose only nearby foe is a fleeing
  captive (intrinsic `non-combatant`) is **not** `in-combat` ⇒ the alarm/door wins its attention over the
  runner. Captives remain a valid **low-priority** attack target (deprioritized, not ignored). Accepted.

---

## Repo discipline this session must honor (D114 / conventions.md)

- A **new decision record** (its own `D##`) capturing the status-vs-tag split, the three provenances, the
  `hasTag` surface, and the minimal-slice scope.
- A **canonical `TAGS` registry** — one spelling per tag, a `getTag`-style fallback — modeled on the
  living exemplar `STATUS_VISUALS` (`src/core/status.ts:285`) and `icons.ts`'s single-source registry.
- A **guard test** that enforces the registry/shape (the pattern conventions.md requires).
- **Player-facing tag names → `docs/design/glossary.md`.**
- **Core purity + determinism:** derived tags are pure fns of battle state; no `Math.random`/Phaser/DOM;
  replay (D22) recomputes from snapshotted state.
- If any tag drives a **player-facing surface** (e.g. `in-combat` shown on a unit, or the batter behavior
  it gates rendering in a scene), add/extend a **visual e2e** (the freeze-catcher doctrine, CLAUDE.md).

---

## What this unblocks (the through-line back to the finale)

`in-combat` (suppresses converge-to-door battering) → makes the **D108 guard doctrine** buildable →
makes the finale's **seal-delay** read as *fair* → the seal-delay is what the whole prison-rescue tension
(and the D99/D116 infiltration flank) rests on. This is finale-checklist crux **C1**.

---

## Key files

- **Consumer to refine:** `src/core/ai.ts` — the D103 walled-off **batter** logic (`~L70` door-break
  value, `~L132/143` the gate/target wiring, `~L307–376` "terrain-walled-off from every seen foe" probe).
  Guards: `src/core/ai.test.ts` (the batter cases). `in-combat` refines *when* a guard peels to batter.
- **Proto-tags to consolidate:** `src/core/units.ts` (`isLord`/`authored`/`thief`/`captured`),
  `src/core/status.ts` (`kind`, D41).
- **Registry exemplars to copy:** `src/core/status.ts:285` (`STATUS_VISUALS`), `src/game/icons.ts`.
- **Seal substrate the doctrine sits on:** `src/core/gates.ts`, `src/core/staging.ts`, D103–D108.
- **Docs:** `docs/design/implementation/conventions.md` (D114), `docs/design/glossary.md`,
  `docs/guides/adding-statuses.md` (the sibling authoring pattern to mirror for tags).
- **Decisions:** `decisions.md` **D108** (guard doctrine / `in-combat`), **D41** (status `kind`),
  **D116/D99** (finale flank), **D103–D107** (gates/levers/destructible seals).

---

## Approach

Plan it first (consider the memento discussion-to-plan / orchestrate workflow), **red-team it**
(`decision-adversary` — especially the R1–R3 rulings and the status/tag boundary), and keep every guard
green (`npm run build` / `test` / `sim`, and `test:e2e:*` for any player-facing surface). Log the outcome
as a new decision record and cross-reference it from the finale checklist (crux C1).

---

## Red-team outcomes (decision-adversary, 2026-07-23) — findings + open decisions

A `decision-adversary` pass, grounded in the code, produced these verdicts. Recorded here; the
**bold open decisions** need owner calls before build. (Verdicts: HOLDS / HOLDS-WITH-GUARD / REOPEN.)

### The load-bearing finding — `in-combat` is nearly redundant with the current gate
`ai.ts` only weighs battering when `wallsOff` = **every seen foe is terrain-unreachable** (ai.ts:310–327),
and any attack on a reachable foe (`actionBase` 1000) outranks door-break (500). You can't trade blows
with an unreachable foe ⇒ at the moment door-break is scored, `in-combat` is essentially never true ⇒
**`in-combat` as an added gate is nearly a no-op** on today's AI. It only becomes load-bearing if the
doctrine is *"a guard abandons a reachable but un-engaged foe to answer the alarm,"* which requires
**reordering attack-vs-objective priority** (let `doorBreak` outrank attacking a reachable un-engaged
adjacent foe when `!in-combat`) + dropping the `!post` clause. That is a real re-architecture, not a gate.
- **OPEN DECISION A (the crux):** is the finale door-doctrine actually the priority-reorder above
  (⇒ `in-combat` is load-bearing, build the reorder + a "don't peel while an un-engaged foe is adjacent
  and reachable" clamp), or does the existing `wallsOff` behavior already express the doctrine
  (⇒ `in-combat` is decorative here, and the honest move is to introduce the *tag vocabulary* on a
  cleaner first use-site, or accept a thin/among-guards role)?

### Status/tag boundary — **REOPEN the taxonomy** (sharpest item)
Clause 1 ("damage exchanged **since U's last turn**") is a **history predicate** — NOT derivable from a
board snapshot (two identical boards with different pasts differ). So the brief's "Derived = pure function
of battle state" is **false as written** for `in-combat`. Two honest fixes:
- **OPEN DECISION B:** either **(i)** redefine *derived* as "pure fn of battle state **including the D87
  combat log**" (legitimizes `in-combat`; points at log-derivation), **or (ii)** concede `in-combat` is a
  **status**, and the tag layer is a **query facade** over statuses + intrinsics (not a third stateless
  kind). Shipping it as "derived, stateless" while backing it with stamped per-unit memory is the one
  framing that is actually false — and it's what the exemplar teaches every future tag. *Lean (i).*

### Engagement memory — **REOPEN; lean (b) log-derived**
- **(a) new per-unit field:** trips the `snapshot-drift` tripwire (must join `UnitSnapshot`), grows every
  undo checkpoint, and carries a **set/clear-ordering footgun**: clear at turn-open (the obvious spot next
  to `tickStatuses`) and it **erases the inter-turn damage it needs ⇒ `in-combat` permanently false ⇒ the
  seal-delay silently never fires.** Only safe if keyed on `clock.time` (which *is* snapshotted) + a
  `lastTurnTime` field, both in the snapshot.
- **(b) log-derived:** no new field, no snapshot growth, replay-free, and the ordering footgun disappears.
  Costs: couples `hasTag` to the combat-log module + an O(log) backward scan per query (cacheable).
- **OPEN DECISION C:** adopt **(b)** (recommended, and it's the same move as B(i)), or **(a)** keyed on
  `clock.time`. Discriminator is the boundary claim + the clear-ordering trap — both favor (b).

### R1 — HOLDS-WITH-GUARD
Coherent, but the *gate* is unspecified (see Decision A). If door-break may outrank a reachable un-engaged
foe, you own a visible **free-hit / peel-then-return oscillation** (guard turns its back on a foe that just
stepped adjacent; eats a free strike; `in-combat` next turn; foe dies; peels again for the next arrival).
Add a "don't peel while an un-engaged reachable foe is adjacent" clamp, or accept it explicitly.

### R2 — HOLDS-WITH-GUARD (the *framing* is backwards)
The window ≈ `100 / speed` ticks. So a **faster guard has a SHORTER window ⇒ forgets a fight sooner ⇒ is
EASIER to distract** — the opposite of "more alert." A fast garrison (speed 20) vs a slow besieger (speed 6)
**answers the door mid-melee for free**; the besieger can't swing fast enough to keep it pinned, and the
seal-tension evaporates exactly for high-Speed defenders (an author-set stat).
- **OPEN DECISION D:** guard the ratio — **floor the window at a minimum number of *unit-turns*** (uniform
  stickiness, besieger cadence irrelevant), or declare as canon that finale garrisons are tuned
  guard-Speed ≤ besieger-Speed. Keep the clock anchor either way.

### R3 — HOLDS-WITH-GUARD
The player CANNOT weaponize non-combatants to pin guards (a non-combatant can't pin — harmless direction).
The one-directional hazard: an **authored `non-combatant` that carries a real attack** = a griefer the AI
ignores while it batters (guard never `in-combat`, takes free chip forever).
- **OPEN DECISION E:** add a D114-style invariant — *a template may not carry `non-combatant` + a usable
  attack* (or the tag forfeits on first damage dealt). Cheap; keeps the tag honest at its first inhabitant.

### Clock semantics — HOLDS-WITH-GUARD (pin the prose)
"Since U's last turn (inclusive)" is ambiguous (current-turn vs previous-turn window; "inclusive" invites a
circular self-justifying read since the plan is computed before the strike). **Ratify the operational
definition:** window = **(start of U's most-recently-*completed* turn, now]**; U's own current-turn damage
does **not** count at plan time; first-turn floor = battle open; charge-resolution damage counts as of the
tick it lands. Under (b) this is exactly "scan the log back to U's previous `endTurn`."

### Highest-risk item to resolve FIRST
The engagement-window **set/clear/read ordering** (Decision C) compounded by the clock-semantics prose.
The obvious-but-wrong implementation makes `in-combat` **permanently false** — every guard always peels,
the seal-delay never triggers — and it is **silent**: `vitest`/`sim` never render a garrison door-fight
(the bot skips deploy/interactive screens). Only a **purpose-built `test:e2e` that opens a real seal
against a real garrison** can catch it. Pin the window semantics + one canonical clear-point, write that
e2e as the gate, *then* build. Adopting (b) makes the ordering trap vanish — the strongest reason to prefer it.
- **Meta-flag (unclosed):** the adversary could not confirm the **`sim` routes any door-break encounter**.
  If it doesn't, R1's free-hit and R2's fast-guard degeneracy are *also* invisible to the digest — verify.

---

## Decision A RESOLVED + reshaped design (owner-confirmed 2026-07-23)

**The finale distraction loop (owner intent).** Two spawn points (D99/D116 flank, `playerSpawns`):
intended play is the **infiltrator alone at the side door, the main party at the front door.** The
**entire garrison, Warden included, shares one drive: get to the doors** — the Warden to **use his key**
(a fast unlock/re-seal Act), the rank-and-file to **batter, turn over turn.** The player **cannot
distract everyone**, so they choose *who* to pin:
- Engage the **Warden** → he is `in-combat` → **cannot key the door** (denies the big prize) → but the
  unattached guards keep battering.
- Engage the **guards** → the Warden slips through and keys it.
A garrison unit **advancing to the objective is choosing NOT to attack**, so it **takes free hits** from
whoever it walks past — that free hit **is the intended tension of the distraction, not a bug.**
`in-combat` is the switch that converts "advancing (and eating free hits)" into "pinned, fighting." The
tension is **force-splitting**: pinning costs bodies you can't use elsewhere.

**Decision A = load-bearing (priority-reorder reading).** `in-combat` is the **sole** off-switch, for the
**whole garrison** (Warden keys, guards batter). This **inverts the red-team's R1 "peel clamp"** — the
free hit is wanted, so we do NOT add a "don't peel while an un-engaged foe is adjacent" clamp.

**Substrate sizing (verified 2026-07-23) — two behaviors the loop needs are NOT built:**
1. **Living keyholder.** Today `keyholder` is a **death-trigger only** (`gates.ts:41`, opens when the
   tagged unit is *defeated*). The Warden *walking to the gate and keying it as an Act* is D108-designed,
   unbuilt. (`openGate` **is** a real logged combat Act — `combat-actions.ts:83` — so the Act shape exists.)
2. **Garrison door-drive as PRIMARY.** Today battering fires only when `wallsOff` (every seen foe
   unreachable, `ai.ts:310`). The loop needs the garrison to pursue the door **even with reachable foes
   around**, outranking "attack the adjacent foe," gated off by `in-combat`. The reorder is unbuilt.

Already built: two-spawn `playerSpawns` + `placeParty`; the Warden unit (`prison-warden`, hollow-mill.ts:384);
keyed/lever gates; the destructible batter; `openGate` Act.

**Agreed scope — full doctrine, milestoned (owner-confirmed).** One session, sequenced so foundations
land green even if the AI work runs long:
- **M1 — tag foundations.** `tags.ts` (`TagDef`/`TAGS`/`hasTag`, `getTag`); `in-combat` (derived — **log-
  derived per Decision B/C**, honest "derived includes the D87 log"); `non-combatant` (intrinsic). Registry
  guard, glossary, `tags.test.ts`. **Green + tested without any drive change.**
- **M2 — living Warden key-drive.** Converge-on-keyed-gate → `openGate` Act; gated on `!in-combat`;
  coexists with the death-trigger keyholder on the same unit. Re-seal interplay with the lever.
- **M3 — garrison door-drive as primary + `in-combat` gate.** The objective-drive outranks attacking a
  reachable un-engaged foe (garrison-scoped — must NOT change generic bandit AI); `in-combat` suppresses it.
- **M4 — the two-spawn distraction e2e** (infiltrator side + party front): assert the garrison eats free
  hits advancing to the objective, a pinned Warden can't key, unattached guards batter, and pinning splits
  the player's forces. The only guard that catches the silent-permanent-false failure.
- Throughout: clock-semantics prose ratified; `non-combatant`+attack invariant (E); the D117 decision
  record. **Deferred as ever:** the `captured`/`thief`/`lord`/`authored` migration.

---

## Red-team 2 outcomes (decision-adversary, 2026-07-23) — the doctrine + milestone plan

Grounded pass on the reshaped design. Key **verified** facts: `PRISON_ASSAULT` (hollow-mill.ts:372–413)
has **no gates/levers/keyed-gate today** and a **single** left-edge spawn cluster; the garrison's
rank-and-file are the **same `bandit-thug/bowman/cutthroat` templates E1 and four other encounters use**;
`role:"captain"` is on **three** encounters (not just the Warden); door-break today is gated by `wallsOff`
**and** `!post`; `openGate` the Act is **lockpick-only**. Verdicts:

### THREE OWNER DECISIONS (fork the build — need calls before M1)
- **DECISION F — the garrison-scoping marker (highest risk; Item 1 REOPEN).** There is **no data marker**
  that scopes M3's primary door-drive to the finale garrison: template and `role` are both non-unique, so
  a global reorder breaks `ai.test.ts:90` + every *future* gated encounter (the day D103's captive→gate
  migration lands, a plain `bandit-thug` inherits "abandon the fight, run at the door" with **no test
  flip**), and an incidental "gates-present" scope silently captures encounter 2. Must name a **per-unit
  marker**. Options: **(F1)** a new `"garrison"` `STANDING_ORDERS` posture authored via
  `overrides:{standingOrder}`, dispatched in the planner exactly like `hold`/`flee` (D81/D84-consistent;
  mutually exclusive with `hold`, which also resolves Item 2); **(F2)** an intrinsic `garrison` tag defined
  in M1 next to `non-combatant`, consumed by M3. *Lean F1* — it's an encounter *role*, not a template
  identity, and rides the proven order-dispatch path. Either way, **pull its definition into M1** so M3 is
  purely the planner reorder consuming an existing marker.
- **DECISION G — does the Warden's keyed gate == the player's lever gate? (Item 3).** A `keyholder` gate is
  **non-destructible → no ratchet**, so Warden-keys-open ↔ player-levers-shut is an **unbounded, cheap
  oscillation**: a unit camped on the *remote* lever re-locks the gate every turn and pins the Warden
  **without engaging him and without `in-combat`** — strictly cheaper than the intended "pinning costs
  bodies" tension. **(G1)** accept lever-camping as a legit tactic (record it), or **(G2)** author the
  Warden's keyed gate and the lever-sealed gate as **different doors** so a ranged lever can't trivially
  undo the key. *Lean G2* (preserves the force-splitting tension).
- **DECISION H — restore the peel-clamp for the RANGED case? (Item 5, leaning REOPEN).** Clause 4 needs
  `E` within striking distance; a guard that free-hits then **advances out of a ranged striker's reach** is
  never `in-combat` against it → **never retaliates**. A Hunter (`attackRange` 3) parks off-lane and **farms
  the whole garrison at zero risk** — the "free hit is intended tension" reasoning held for *melee* (eats a
  counter next turn), not ranged. Options: **(H1)** accept ranged free-farm as skill expression; **(H2)**
  relax the window so *being damaged this window* keeps `U` `in-combat` even when it can't currently strike
  `E` — then a shot guard **peels off the door to chase the shooter** (a *successful distraction*, not a
  farm) — but this **reopens ratified clause 5** and needs the in-combat behavior to include "advance on the
  attacker"; **(H3)** a casualties-taken-while-advancing ceiling asserted in M4 (catch the farm in the
  digest) without changing the rule. *Lean H2 as the elegant fix, but it edits a ratified clause — owner
  call.* Regardless, **M4 asserts a free-casualty ceiling.**

### ADOPTED GUARDS (no fork — folding into the plan)
- **Item 2 (HOLDS-WITH-GUARD):** the drive is a **new posture dispatched like `hold`/`flee`, never a
  mutation of the order-less default path** — satisfied by F1.
- **Item 4 (HOLDS-WITH-GUARD):** keep M1 as a **build-order checkpoint**, but D117 must state M1 ships
  **unconsumed vocabulary** (dead-code until M3); the behavior proof is **M4, not M1**.
- **Item 6 (HOLDS-WITH-GUARD):** the Warden's key-open is a **first-class logged `CombatAction`** (mirror
  `attackGate`), lowered from a new `AIPlan` **second gate field** (key-target vs batter-target); add a
  **replay-equality** test + an **undo-re-locks** test. Without this, replay/save diverges silently.
- **Item 3 idempotency:** one test that death-trigger + living keyholder on the same unit **don't
  double-emit `gateOpened`** (both paths already filter `g.locked` — should hold).
- **Item 7 (HOLDS-WITH-GUARD):** **split the coverage** — unit tests in `ai.test.ts` for the reorder
  (`garrison` unit + adjacent reachable foe + breakable gate ⇒ `plan.gateTarget` set, not `plan.target`;
  `in-combat` ⇒ `plan.target` set); reserve the **e2e** for what only a render catches — **no freeze** on
  the key-open surface + the **silent-permanent-`in-combat`-false** failure (boot finale, leave Warden
  unengaged, run N turns, assert the keyed gate **opens with a logged key-cause event**; engage him, assert
  it **stays shut**).

### REVISED SEQUENCE (two changes)
1. **M1 — tag foundations + the scoping marker.** `tags.ts`/`TAGS`/`hasTag`; `in-combat` (log-derived);
   `non-combatant` (intrinsic); **+ the Decision-F marker** so M3 consumes, not invents. Registry guard,
   glossary, `tags.test.ts`, the `non-combatant`+attack invariant (E). Green on unit tests.
2. **M2 — living Warden key-drive.** Converge-on-keyed-gate → **logged** key-open Act (Item 6); gated on
   `!in-combat`; coexists with the death-trigger keyholder (idempotency test). Self-scoping (only a
   keyholder-tagged unit + an authored keyed gate fires it).
3. **M2.5 — author the finale substrate (NEW; the plan had no step for it).** Into `PRISON_ASSAULT`: the
   destructible seal (batterers), the keyed gate (Warden, tag `{role:"captain"}`), the lever (Decision G
   determines same-vs-different door), the keyholder death-trigger, and **split two-cluster `playerSpawns`
   + deterministic Thief placement**. M3 and M4 have nothing real to test against without this.
4. **M3 — garrison door-drive as primary + `in-combat` gate.** The planner reorder consuming the
   Decision-F marker (outranks attacking a reachable un-engaged foe; suppressed by `in-combat`). Unit tests
   per Item 7; must **not** flip generic-bandit behavior (the `ai.test.ts:90` canary stays green).
5. **M4 — the two-spawn distraction e2e** + the free-casualty ceiling (Decision H) + freeze/seal-fires
   assertions. Then the **D117** record. **Deferred as ever:** the boolean migration.

---

## Forks F/G/H RESOLVED (owner-confirmed 2026-07-23) — plan locked

- **F → intrinsic `garrison` tag (F2, reconciled).** The finale garrison will be **its own units /
  modifications of base units**, not E1's shared `bandit-thug/bowman/cutthroat` — so the blast-radius worry
  dissolves and the marker rides the garrison's own identity. Implemented as an **intrinsic `garrison` tag**
  on those templates, read by M3's door-drive via `hasTag`. Makes the tag surface carry **three** tags
  (`in-combat` derived · `non-combatant` intrinsic · `garrison` intrinsic) — a stronger living exemplar.
  **Composes with `hold`:** an explicit `hold` order still wins (a posted garrison unit holds; an order-less
  garrison unit runs the door-drive). Generic order-less bandits lack the tag ⇒ never door-driven. This
  **defuses Item 1** without a global reorder and keeps `ai.test.ts:90` green.
- **G → same door, and the Warden walks THROUGH it (G1+).** The lever and the Warden's key act on the
  **same** gate. The Warden doesn't key-and-loiter — he **opens it and advances through to engage the
  control room.** New requirement: **after a breach, the garrison prioritizes control-room occupants as
  targets** (the infiltrator working the lever/objective). This is the elegant answer to Item 3's
  lever-camp degeneracy — camping the lever inside now gets you **attacked**, so it is no longer a free,
  bodiless pin. *Needs:* the "control room" made identifiable in M2.5 (a region marker, or proximity to the
  objective/lever) + a target-priority weight in M3.
- **H → keep ratified clauses 4 & 5; guards don't chase the unreachable (reject H2).** A guard fights back
  only if the attacker is **within its reach**; a ranged unit plinking from out of reach does **not** pull
  the guard off the door (it does not focus a target it can't reach). No edit to the ratified spec. If the
  numbers ever make ranged plinking a genuine farm, the **M4 free-casualty ceiling** catches it in the
  digest — a tuning tripwire, not a rule change.

### Locked plan (supersedes the M1–M4 sequence above where they differ)
- **M1 — tag foundations (three tags).** `tags.ts`/`TAGS`/`hasTag`/`getTag`; `in-combat` (log-derived,
  clauses 1–5 unchanged); `non-combatant` (intrinsic) + the `non-combatant`+attack invariant (E);
  **`garrison` (intrinsic)**. Registry guard, glossary, `tags.test.ts`. Green on unit tests. D117 notes M1
  ships vocabulary consumed only from M2/M3 (behavior proof is M4).
- **M2 — living Warden key-drive.** Converge-on-keyed-gate → **logged** key-open `CombatAction` (mirror
  `attackGate`; new `AIPlan` key-target field distinct from batter-target) → **advance through** the opened
  gate; gated on `!in-combat`; coexists with the death-trigger keyholder (idempotency test); replay-equality
  + undo-re-locks tests. Self-scoping (keyholder-tagged unit + authored keyed gate).
- **M2.5 — author the finale substrate.** Into `PRISON_ASSAULT`: the destructible seal (batterers), the
  **single** keyed+lever gate (Decision G), the keyholder death-trigger, an **identifiable control room**
  (region/objective marker for the G target-priority), and **split two-cluster `playerSpawns` + deterministic
  Thief (infiltrator) placement**.
- **M3 — garrison door-drive as primary + gate + control-room targeting.** Planner reorder consuming the
  `garrison` tag (door-drive outranks attacking a reachable un-engaged foe; suppressed by `in-combat`;
  `hold` still wins); **post-breach target-priority weight toward control-room occupants** (Decision G).
  Unit tests per Item 7; the generic-bandit canary (`ai.test.ts:90`) stays green.
- **M4 — two-spawn distraction e2e + free-casualty ceiling + freeze/seal-fires assertions** → then the
  **D117** decision record. **Deferred as ever:** the `captured`/`thief`/`lord`/`authored` migration.

---

## M1 LANDED (2026-07-23) — tag foundations, green

- **`tags.ts`** — `TagProvenance` (intrinsic/conferred/derived), `TagContext` (the narrow query
  interface derived tags read — `units` + `exchangedDamageSince`, so `tags.ts` never couples to the
  `CombatAction` union or the scene), `TagDef`, `TAGS` registry, `getTag`, `hasTag`. Three tags:
  **`in-combat`** (derived — clauses 1–5, the log-history bit behind `ctx.exchangedDamageSince`),
  **`non-combatant`** + **`garrison`** (intrinsic). `hasTag` throws on an unknown tag id and on a
  derived tag with no ctx (fail-loud).
- **`Unit.tags` / `UnitSpec.tags`** — intrinsic authored classifications; immutable in battle →
  classified **unsnapshotted** in `snapshot-drift.test.ts`.
- **Guards:** `tags.test.ts` (registry integrity + `hasTag` resolution + `in-combat` clause-by-clause,
  each clause independently gating); barrel pin **+6** (`TAGS`/`getTag`/`hasTag`/`IN_COMBAT`/
  `NON_COMBATANT`/`GARRISON`); conventions.md **Tags row**. `npm run build` clean, **1273/1273** core,
  **sim digest unchanged**.
- **DECISION E REVERSED (owed a confirm):** the red-team's "a `non-combatant` may not carry a usable
  attack" invariant was **NOT built** — it contradicts the brief's own definition (`non-combatant` =
  "a unit that *can* deal damage but is **deprioritized** as a target — not ignored"). `non-combatant`
  is a **target-priority + `in-combat`-conferral** classification, not a can't-fight flag. If an
  attack-carrying non-combatant ever proves a balance problem, the **M4 free-casualty ceiling** is the
  tuning guard — not an authoring ban.
- **Glossary deferred:** no tag renders yet (glossary scope = player-facing text); entries land when
  `in-combat` gets a unit indicator (M4). The internal vocabulary lives in conventions.md now.
- **Next:** M2 — the living Warden key-drive (logged key-open `CombatAction`, walks through, `!in-combat`).

---

## /challenge outcome (M1 implementation, 2026-07-23)

Adversarial pressure-test of the *landed code* (not the design). **Mutation battery** — each clause
of `deriveInCombat` and the `TAGS` key⇔id link was deliberately broken and the suite re-run; **every
mutation turned a test red** (drop clause 1/2/3/5 → 1 test each; clause-4 `<=`→`<` → 3 tests; broken
`garrison` key → registry-contracts). So the clause-by-clause tests are the preserved guard — a
dropped clause **cannot** ship green; no separate mutation script is needed.

**Finding acted on — `conferred` dropped (owner-confirmed).** It was unexercised speculative code (a
mutation there would survive); its design example `flanked` is *derived* not status-shaped
(`combat.isFlanked` is positional-by-D36-design), so it wasn't a real consumer. Dropped from shipped
code (`TagProvenance`, `TagDef.conferredBy`, the `hasStatus` import + the `hasTag` branch), keeping the
three-provenance **model** documented as the seam. **Two revisit threads recorded in `tags.ts`:**
(1) conferred's honest debut = a `captured` tag projecting a future `captured`-status; (2) **re-examine
flanked-as-status** — suspected to simplify later behaviors (owner), to test before the 2nd AI consumer.

**Findings carried forward (not fixed at M1 — no substrate yet):**
- **M2.5:** add a guard that every authored template `tags` entry is a registered `TAGS` id (a designer
  typo is a silent no-op today; can't fail-loud in `createUnit` without a `units↔tags` import cycle).
- **M2 test requirements (load-bearing assumptions M1 can't test):**
  - `exchangedDamageSince(a,b)` is **first-arg-window-anchored, NOT symmetric** — the Battle's log scan
    must anchor to the first arg's last completed turn; M2 tests must cover the asymmetry + the R2 speed
    window. (M1's test stub is symmetric for wiring only — a simplification, not the contract.)
  - clause 2 uses `isActive`, narrower than "targetable" (omits `concealed`/`hidden`); inert today
    (combat clears `concealed`, no hidden garrison) — M3 must confirm no spurious flip against a veil.
  - clause 5 `canDamage` = `attack > 0` ignores skill-only damage dealers; no such unit today.

---

## Parked thread — the droppable key (owner idea, 2026-07-23)

**Idea (owner):** on the Warden's **defeat**, he **drops the key as a physical object** so the player can
pick it up and open the (possibly-closed) door themselves — instead of the door auto-opening.

**This is D108's explicitly-deferred *transferable in-encounter item system*** ("a guard drops a key,
another picks it up and uses it" — confirmed no board item-pickup today). Owner independently re-derived
its motivating use-case.

**Two architectures for the keyholder:**
- **A — keyholder as a TAG (current / what M2–M3 build).** The Warden *is* the keyholder (tag); alive he
  walks-and-keys (M2 drive), dead his gates **auto-open** (`gatesOpenedByDeath`). No item object. Ships
  the finale with no new subsystem.
- **B — key as an ITEM (owner's proposal).** One key object changes hands: Warden uses it alive → dies →
  **drops it** → a player unit grabs it → uses it. Unifies the living-key-drive *and* the death-open into
  one "whoever holds the key can open its doors" rule; adds player agency over when/which door.

**Not from zero:** the nearest substrate is `entities.ts` (field entities on the trigger bus, e.g. traps
via `onUnitEnterTile`). A dropped key = a field entity; a player stepping on its tile picks it up (a
**carried-key** state, snapshotted for undo); the **use-key Act reuses M2's `keyGate` Act**. Pieces: key
field-entity + pickup hook + carried state + the shared Act.

**Decision (lean, to confirm):** ship **A** for the finale now — it **upgrades cleanly to B** (the
`keyGate` Act is shared, living-key-drive → carries-key-use-drive, death-auto-open → drop-key; nothing
built now is thrown away). Pull **B** as its own scoped thread/milestone after the finale plays.
**Open:** does killing the Warden auto-open (A) or drop-a-key-to-fetch (B) for the shipped finale?

---

## Plan refinement (owner-directed 2026-07-23) — the event log + M5 key-drop

**Point 1 — one structured event log for both display and queries (owner).** Grounded in code:
`event-bus.ts` already emits **`unitDamaged {unit, amount, source}`** (+ healed/defeated/…) but the bus
is **transient**; the stored `CombatAction[]` is the *command* log (replay source of truth, but carries
no damage amounts — derived by replay); **no persisted combat log exists** for display or queries.
- **Build ONE stored, tick-stamped combat *event* log** on `Battle`, populated from the existing bus
  (append `unitDamaged` etc. with `clock.time` + turn boundaries). **Kept separate from the command log**
  (command = replay *inputs*, authoritative; event log = derived *outputs*). Replay re-emits events
  deterministically ⇒ the event log reconstructs identically; **undo truncates it** like the command log
  (checkpoint records its length). `replay(commandLog) === state` is untouched.
- **`in-combat`'s `exchangedDamageSince(a,b)`** = filter the event log for damage between `a` and `b`
  since `a`'s last turn boundary. No re-derivation. **Player-facing combat-log display** reads the same
  log (a later consumer, not M2).

**Point 4.2 — auto-open now, droppable key required before the finale node is done (owner).**
- Ship **A** (all doors auto-open on Warden death, tag-based) in M2–M3. ✓
- **M5 (NEW, required before the finale node is finished):** the **droppable key** — the *specific*
  key-drop only (a key field-entity via `entities.ts` + a minimal pickup → carried state + the **shared
  `keyGate` Act**), upgrading death-auto-open → drop-key. **NOT** the general droppable-item system
  (that stays deferred, D108). The finale node isn't "done" until the key drops.

### Locked plan v2
- **M1 ✓** — tag foundations (3 tags, `hasTag`, log-derived `in-combat` via `TagContext`).
- **M2** — (a) the **combat event log** (stored, tick-stamped, bus-fed, replay/undo-safe) + `Battle`'s
  real `TagContext.exchangedDamageSince` reading it, isolated-tested (first-arg window + R2 + isActive
  edge); (b) the logged **`keyGate` Act** (key-vs-batter derived from keyholder-match; replay/undo tests);
  (c) the Warden keys-and-walks-through under a minimal trigger. **No doctrine/gating yet.**
- **M2.5** — author the finale substrate (seal/lever/keyed gate, control-room region, split spawns) +
  the tag-id validation guard (every authored `tags` entry ∈ `TAGS`).
- **M3** — the AI doctrine consuming a proven `in-combat`: primary door-drive (outranks a reachable
  un-engaged foe), `garrison`-scoped, `!in-combat`-gated, `hold` still wins; control-room targeting.
- **M4** — two-spawn distraction e2e + free-casualty ceiling + freeze/seal-fires assertions → D117.
- **M5** — the droppable key (auto-open → drop-key), required before the finale node is finished.

---

## /challenge the plan (M2(a) event-log foundation, 2026-07-23) — SURVIVED + hardened

Pre-mortem of the "bus-fed event log is replay-reconstructed / undo-truncated" claim, verified in code.

**Held (load-bearing assumptions, now checked, not assumed):**
- **Replay re-emits:** `replay()` loops `battle.apply(log[i])` (battle-replay.ts:81/91) ⇒ the interpreter
  re-fires bus events ⇒ the event log reconstructs identically. Replay-safe by construction.
- **Planning is pure:** `ai.ts` never calls `apply`/`applyDamage` ⇒ hypothetical damage can't pollute it.
- **Undo:** `BattleCheckpoint` already carries `logLen`/`drawCount`; add one `eventLogLen` scalar (mirror).
- **Auto-open already exists:** `openKeyholderGates` is wired to `unitDefeated` (turn.ts:195) — architecture
  A ships today; M2/M3 don't build it.

**Three findings — silent bugs caught, now REQUIRED in M2(a):**
1. **Filter `amount > 0`.** `applyDamage` emits `unitDamaged` even for 0 damage (combat.ts:~285, no guard),
   so a 0-damage swing would spuriously engage. `exchangedDamageSince` must require real damage. (This also
   *justifies* the event log over a command-log scan — the command log can't distinguish a hit from a whiff.)
2. **Window = `[a's previous `turnEnd` → now]`, NOT `[a's current `turnStart` → now]`** — the red-team item-6
   boundary; the wrong pick makes `in-combat` **permanently false** (guards always peel). The log's own
   `turnEnd` entries give it for free (at planning, a's most-recent logged `turnEnd` is its *prior* turn).
   **Direct guard test required:** a unit hit on a foe's turn reads `in-combat` on its next turn.
3. **Store IDs, not `Unit` refs** in log entries (`{targetId, sourceId, amount, tick}`) — the D111 /
   command-log discipline (the bus event carries live `Unit` refs; the persisted log must not).

**Verification gates:** `r1-log-totality` golden replay pin stays green (event log is derived, separate from
the command log's `replay===state`); **sim digest byte-identical** (passive recording, no RNG, no outcome
change). No architecture change — the event log is validated (both alternatives are strictly worse).

---

## M2(a) LANDED (2026-07-23) — combat event log + real `in-combat`, green

- **`combat-log.ts`** — a stored, tick-stamped **event log** (`CombatLogEntry`: `damage` + `turnEnd`;
  IDs not refs) + the pure **`exchangedDamageSince(log, a, b)`** window query. `Battle` (`turn.ts`) feeds
  it from the bus (`unitDamaged`/`turnEnd`), exposes `eventLog` + **`tagContext()`**; `BattleCheckpoint`
  gained `eventLogLen` (undo truncates the event log alongside the command log).
- **Guards:** `combat-log.test.ts` (13) — pure window semantics + a live-`Battle` suite proving bus-fed
  population, the **finale case** (damage received since last turnEnd ⇒ in-combat), the **self-clearing
  window**, **replay reconstruction** (`replayed.eventLog` deep-equals), and **undo truncation** (flips
  in-combat back). Barrel **+1** (`exchangedDamageSince`). **Build clean · 1286/1286 · r1-log-totality
  green (replay===state intact) · sim digest byte-identical.**
- **The three /challenge findings, all honored:** filter `amount > 0` (whiffs don't engage); window is
  `(a's last turnEnd, now]`; entries carry IDs, not `Unit` refs.

- **⚑ WINDOW-BOUNDARY DEVIATION — owner confirm.** The ratified clock-semantics text said the window is
  `(start of U's most-recently-completed turn, now]`. Implementing that **literally is not replay-safe**:
  it needs a `turnStart` boundary, but `turnStart` fires outside `apply` (`nextActor`, turn.ts:634) and
  would **not** reconstruct on replay — only `turnEnd` is apply-reachable. So the shipped window is
  **`(U's last `turnEnd`, now]`**. Behavioral consequence: a unit is engaged by **receiving** real damage
  since it last finished a turn (its *own* last-turn swings don't self-pin). This is **finale-aligned** —
  the player pins a guard by *hitting* it; "the guard takes free hits while advancing and stops when
  actually struck" falls straight out; a ranged guard plinking while advancing isn't self-pinned (matches
  the H ruling). **Lean: keep this window** (it's the only replay-safe realization and behaviorally right);
  flagging because it narrows the ratified wording's "dealt-damage-during-own-last-turn" inclusion.
