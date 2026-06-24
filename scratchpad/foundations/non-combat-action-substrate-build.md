# Build prompt — The non-combat action substrate (unify overworld-action registration)

> **Status:** ready to dispatch. The *consuming kits* are designed + recorded — **D70** (Merchant) and
> **D71** (Cook & Noble) in `scratchpad/foundations/decisions.md`, with worked examples in
> `docs/design/systems/jobs.md` (commit `218e949` on `claude/busy-cori-h83bpp`). This brief is the
> **shared machinery** those kits need *before* they can be built.
>
> **This is a design + build brief.** Unlike a pure build brief, the substrate's design is **not yet
> decided** — D70/D71 deliberately deferred it. So: **resolve the open architectural calls (below) with
> the owner, record a decision, then build** — proven with fixtures.
>
> **Decision to record:** a new record, **likely D72** — re-confirm the next free number against
> `decisions.md` at build time (**D69** is reserved for Scout-fork follow-ons; D70/D71 are taken).
> Sibling in spirit to **D61** (the two-axis limiter) and **D65** (the grant seam).
>
> **Consumers it must support (do NOT build their kits here):** Merchant (Appraisal · Find Trade ·
> Savvy Barter) · Cook (Field Kitchen · Cook Stew · Feast) · Noble (Renown · Patronize · Bribe). Wiring
> those real kits is the **following content pass** — exactly as the Scout/Soldier per-class passes
> consumed the D65 prestige substrate. Prove this substrate with **throwaway fixtures**.
>
> **Verify every `file:line` ref against the live tree at build time** (the tree shifts).

## Goal (one line)

Collapse the **3+ ways an overworld/camp action is authored today** into **one registration substrate**
— one home, one cost gate, one surfacing projection — and add the **primitives the non-combat triad
needs** (computed costs · per-node & one-shot ability state · Upkeep-coupling · presence/faucet
declaration · capability gates), proven end-to-end with fixtures and **no real class content**.

## Why — the problem this design session surfaced

Authoring "a thing a class does between nodes" currently follows **three-plus inconsistent patterns**,
only one of which is enforced-consistent:

| Pattern | Authored in | Gating | Cost gate + invariant | Surfaced via |
|---|---|---|---|---|
| Registry `OverworldAbility` | `OVERWORLD_ABILITIES` (global) + the `OverworldEffect` union | `jobIds[]`, enforced | ✅ two-axis, validated at load | **hardcoded by id** (`getAbility("survey")`) |
| Meta camp `SkillDef` | `JobDef.skills` | implicit (it's on the job) | ✅ `useCampSkillAtNode` (no load-time check) | generic — `availableSkills(u,"overworld")` |
| Economy verb (fn) | standalone fns in `economy-actions.ts` | ad-hoc (`hasNoble` / `merchantFloor` / none) | inconsistent (buy routes it; sell is `selfLimited`; borrow neither) | bespoke buttons / drawers / overlay |
| Bespoke gated fn | standalone fn | capability (`isHealer`) | ✅ routes the gate | bespoke |

The new non-combat verbs (Find Trade, Savvy Barter, Cook Stew, Feast) have **no clean home**, and several
need **primitives that don't exist** (a computed cost, per-node / one-shot state, an Upkeep coupling).
Building the kits onto this fragmentation would deepen the mess — hence this substrate **first**.

## The open design decisions (resolve + record before coding)

**These are owner-facing architectural calls — surface them, recommend, confirm.** They were
deliberately left open by D70/D71.

**1 (the keystone) — Where do job overworld abilities live?**
- **A1 · Extend `OVERWORLD_ABILITIES`.** New verbs = registry records (`jobIds` + a declarative
  `OverworldEffect` + a handler). *Pros:* purpose-built; **Survey** is the precedent; already carries
  jobIds / cost / targeting / use-XP. *Cons:* separate from the `JobDef` ("what can a Merchant do?"
  means filtering the registry); the render surfaces registry abilities **by hardcoded id** (needs the
  new projection); the meta-`SkillDef` home persists in parallel.
- **A2 · Put them on `JobDef.skills` with `usableContext:["overworld"]`** (how Cook Stew already
  works). *Pros:* co-located with the class (discoverable); surfaces through the **existing
  `availableSkills` projection (D67)** — one path with combat/deploy; consistent with combat classes.
  *Cons:* `SkillEffect` wasn't built for overworld-economy mutations (needs new effect kinds + camp
  resolvers); no multi-job allowlist (fine — non-combat verbs are single-job); Survey + the economy
  verbs still need migrating or bridging.
- **A3 · The north star — one home for *all* job actions.** Migrate Survey + the economy verbs onto
  `JobDef`s; `availableSkills`/`availableAbilities` becomes the single projection. *Pros:* truly one
  model. *Cons:* the biggest refactor.
- **Lean:** **A2 as the direction, A3 as the horizon** — it extends D67's already-unified surfacing
  rather than entrenching a second home; the registry's extras (jobIds, declarative effect) are
  subsumable, and the economy verbs can stay as functions *called by* the resolvers initially
  (incremental migration). **Owner's call — present the trade-offs.**

**2 — Computed (dynamic) costs.** Cook Stew's cost = *the night's Food upkeep value* (party-scaled), but
`OverworldCost.gold` is a **static number** (`overworld-actions.ts`). Resolve: let a cost knob accept a
**provider** (`gold?: number | (run) => number`, evaluated in `checkOverworldCost`), or add a typed
`foodUpkeep` cost kind the gate computes from `computeUpkeep`. *Lean:* the cost-provider (generic, minimal).

**3 — Per-node & one-shot ability state.** Find Trade needs a **per-node "market opened here"** flag
(reset each node-step, folded into `effectiveMarketTier`); Savvy Barter needs a **one-shot "next deal
primed"** flag (read + consumed by `merchantBuy`/`merchantSell`). Resolve: ad-hoc fields on
`OverworldEconomy` (like `campUses`/`scouted`) vs a small **general ability-flag bag** (per-node +
per-run, reset by `tickCooldowns`). *Lean:* a general bag — more verbs will want this.

**4 — Presence & faucet declaration.** Appraisal (market +1 tier) and Renown (Influence/step) are
**presence effects**; the per-step faucets (interest / Influence / Deft-Hands) are **hardcoded in
`run.breakCamp`**. Resolve: keep ad-hoc, or let a `JobDef` **declare** a presence effect + a per-step
faucet (data, + card surfacing). *Lean:* a light declaration (so a class's presence is data and the card
can read it) — but this can be a phase-2 increment.

**5 — Gate coverage.** The substrate must express the full **gate taxonomy**
(`docs/design/systems/actions.md`): **Class** (`jobIds`/`hasX`) · **Capability** (holds a skill/passive
— Triage / `lockpick`) · **Stat** (quality scales) · **Access** (where a resource exists; a class
extends reach — Buy/Sell) · **Universal**. The registry has only `jobIds` today — add a **capability
predicate** option (reuse the `isHealer` / `canDisarm` shape).

## Scope rule (read twice)

> Build the **generic machinery + the primitives**; author **no real class kit**.

- **IN:** the registration home (decision 1) + decisions 2–5; the surfacing projection
  (`availableAbilities`, or the `availableSkills` extension) so the camp UI stops hardcoding
  `getAbility("survey")`; computed-cost support; per-node / one-shot state; presence/faucet declaration;
  capability-gate support; an exhaustive handler registry for any new effect union; **fixtures** that
  exercise every shape.
- **OUT (the following content pass — do NOT touch):** the real **Merchant / Cook / Noble kits**
  (Appraisal / Find Trade / Savvy Barter · Field Kitchen / Cook Stew / Feast · Renown), the
  `chef`→`cook` rename, and the **numbers pass**. Those consume this substrate next. Tests use
  **throwaway fixtures**, never real kit content.

## Project invariants (non-negotiable)

- **Pure core / render split (D2):** all logic in `src/core/` — no Phaser, no DOM, **no `Math.random`**
  (seeded streams only; `rng.test.ts` greps for it — keep it green).
- **Determinism:** the headless sim stays **byte-identical** where behavior shouldn't change (re-run
  equality in `sim.test.ts`). Fixtures **never** enter the live registries (`JOBS` / `OVERWORLD_ABILITIES`
  / `STORIES` / the event pool) — they shift deterministic selection and break the sim. Inject fixtures
  into the unit under test only.
- **Green at every increment:** `npm run test`, `npm run build` (`tsc --noEmit && vite build`),
  `npm run test:e2e`, `npm run sim` all pass after **each** increment; each increment self-contained +
  reversible.
- **Data-driven (D3/D4 ethos):** new abilities / effects / gates are **new records**, not new switch
  arms. Mirror the exhaustive mapped-type registries already in the tree — `BATTLE_EFFECT_HANDLERS`
  (`skills.ts`), `FORECAST_HANDLERS` (`ability-forecast.ts`), `GRANT_EFFECT_HANDLERS` (`grants.ts`) — so a
  new kind fails the build until it has a handler.

## Current seams (verify, then build on)

All in `src/core/` unless noted (line numbers approximate — re-verify):

- **The registry + gate + interpreter** (`overworld-actions.ts`): `OverworldCost` (two-axis: pacing
  `cooldown`/`usesPerNode` × price `fatigue`/`gold`/`influence`/`rp` + `selfLimited`); `validateOverworldCost`
  (the no-free-and-unlimited invariant, run at load); `OverworldAbility` (`id`/`name`/`effect`/`cost`/
  `jobIds?`); `OverworldEffect` (only `SurveyEffect` today) + `applyEffect`; `OVERWORLD_ABILITIES` (one
  entry: `SURVEY`); `checkOverworldCost` / `commitOverworldCost` (the single gate — **camp jobs, registry
  abilities, and economy verbs all route through it**); `useCampSkillAtNode` + `campSkillCost` (the
  meta-`SkillDef` path); `takeOverworldAction` (the registry interpreter — enforces `jobIds`, grants
  use-XP); `triage` + `isHealer` (the capability-gated bespoke fn); `OverworldEconomy` (per-run state:
  `cooldowns` / `scouted` / `campUses` reset by `tickCooldowns`, + `interestPerStep` / `debt` /
  `protection` / `influence`).
- **The surfacing projection** (`leveling.ts` `availableSkills` + `skills.ts` `skillContexts` /
  `UsableContext = "overworld"|"guild"|"pre-combat"|"combat"`): the D67 one-projection-for-every-surface.
  Registry abilities are **not** in it yet (the gap).
- **The economy verbs** (`economy-actions.ts`): `merchantBuy`/`merchantSell` (market-gated, not job-gated;
  sell grants the broker use-XP), `bankerEngageInterest`/`bankerBorrow`/`bankerProtect`,
  `patronize`/`bribeEnemy`, `deftHandsSkim`; `hasBanker`/`hasNoble`/`hasThief`. The per-step faucets fire
  from `run.breakCamp` (`accruePurseInterest` / `accrueNobleInfluence` / `deftHandsSkim`).
- **Presence reads** (`overworld.ts`): `merchantFloor` / `effectiveMarketTier` / `MarketTier`
  (`none<poor<basic<premium`) — the pattern Appraisal extends.
- **Upkeep** (`upkeep.ts`): `UPKEEP`, `computeUpkeep` (Food line = `chefFoodPerUnit×size` with a Cook),
  `payUpkeep` (+ the D45 voluntary-skip per-line tracking — the natural home for Cook Stew's
  "food prepaid" flag).
- **RP** (`upkeep.ts` `rpPerNight`/`restHeal`; `runloop.ts` `restNode`/`inPlaceRest`/`REST`; `run.rp`):
  Cook Stew **banks into `run.rp`** — no new RP machinery, just the bank-on-cook.
- **The render** (`src/game/scenes/OverworldScene.ts`): `campRecoveryActions` (the `availableSkills`
  loop), the economy drawer, `getAbility("survey")` **hardcoded** (2 sites), `merchantBuy`/`merchantSell`
  buttons. This is what the new projection should de-duplicate.
- **Stale doc note:** `docs/design/systems/actions.md`'s **overworld/gate** model is current and
  authoritative for this brief, but its **combat-skills** rows predate D66/D68 (legacy Soldier/Scout) —
  don't trust those; a one-line fix is a fair follow-on.

## The build (increments — each green, each reversible)

> Adjust to the decisions resolved above; this is the expected shape under the leans.

1. **The unified ability shape `[CORE]`** — per decision 1, establish the home: either extend
   `availableSkills`/`SkillDef` to carry overworld abilities (A2), or generalize the registry + add an
   `availableAbilities(unit, context)` projection (A1). Either way the render gets **one list of a unit's
   eligible overworld actions** (no hardcoded ids). Keep `jobIds` gating + use-XP.
2. **Capability gates `[CORE]`** — per decision 5, let an action gate by a **capability predicate**
   (the `isHealer`/`canDisarm` shape), not only `jobIds`. Fold Triage + the market-`Access` pattern into
   the taxonomy so the gate kinds are explicit data.
3. **Computed costs `[CORE]`** — per decision 2, the cost gate accepts a **provider** so Cook Stew's
   cost can be "the night's Food value". Keep the two-axis invariant.
4. **Per-node / one-shot ability state `[CORE]`** — per decision 3, a general flag mechanism on
   `OverworldEconomy` (per-node reset on `tickCooldowns`; per-run; one-shot consumed-on-read). Fold the
   per-node read into `effectiveMarketTier` (the Find-Trade shape) and provide a consume-on-next-use
   helper (the Savvy-Barter shape) — **with fixtures, not the real verbs.**
5. **Effect-handler registry `[CORE]`** — an exhaustive mapped-type registry for the new effect kinds
   (open-market / prime-deal / bank-RP-and-satisfy-food / …) mirroring `BATTLE_EFFECT_HANDLERS`. Wire the
   **Upkeep coupling** primitive (an effect can satisfy/zero an Upkeep line; `payUpkeep` reads it; the
   camp flow orders it before billing) — again proven with a **fixture** effect, not Cook Stew itself.
6. **Presence / faucet declaration `[CORE]`** *(optional / phase 2, per decision 4)* — let a `JobDef`
   declare a presence effect + a per-step faucet as data; have `effectiveMarketTier` / the `breakCamp`
   accruals read the declarations instead of hardcoded fns. Card surfacing hook.
7. **Fixtures + tests `[CORE]`** — throwaway fixture jobs/abilities exercising **every** shape: a
   job-gated active; a capability-gated active; a computed-cost active; a per-node-state active folded
   into a read; a one-shot primed modifier consumed by a follow-up; an Upkeep-satisfying effect (no
   double-charge, ordering correct); a presence declaration read at its site. Determinism: the live sim
   stays byte-identical (fixtures not registered); the new paths are seed-stable.
8. **The decision record + glossary `[DOCS]`** — record D72 (re-confirm the number): the resolved
   decisions 1–5, the substrate's shape, and that the three kits are the next content pass. Update the
   roadmap (this item → built). Add any new glossary keyword if a new concept lands.

## Completeness checklist (don't open the PR until every box is true)

- [ ] Decisions 1–5 **resolved with the owner** and recorded (D72 or the confirmed number).
- [ ] **One home** for a job's overworld actions + **one surfacing projection**; the render no longer
      hardcodes `getAbility("survey")` (Survey flows through the projection like any other).
- [ ] **Capability gates** supported alongside `jobIds` (Triage/`Access` expressible as data).
- [ ] **Computed costs** work (a fixture action priced at "the night's Food value"); the two-axis
      invariant still holds.
- [ ] **Per-node** state (folded into a read) **and** **one-shot** primed state (consumed on next use)
      both work — via fixtures.
- [ ] An effect can **satisfy an Upkeep line** with correct ordering + no double-charge (fixture).
- [ ] Exhaustive effect-handler registry — a new effect kind fails the build until handled.
- [ ] *(if in scope)* presence/faucet **declared as data** and read at its site.
- [ ] **Zero real kit content** (no Appraisal/Find-Trade/Savvy-Barter/Cook-Stew/Feast/Renown wiring, no
      `chef`→`cook` rename); **no fixture in a live registry.**
- [ ] `test` / `build` / `test:e2e` / `sim` green at **every** increment; **sim byte-identical**.

## Boundaries

- **Author NO real class kit.** The Merchant/Cook/Noble kits (D70/D71) are the **next content pass** that
  consumes this substrate — use **fixtures** here. (Mirror: the Scout/Soldier passes consumed the D65
  prestige substrate; the substrate shipped with fixtures only.)
- **Build the machinery once.** If a kit pass starts in parallel, it rebases on this — don't let it
  re-invent the registration shape.
- The **numbers pass** (Cook Stew RP, Feast magnitudes, the `restPoints` floor, Find-Trade limiter cost,
  Savvy-Barter pacing) belongs to the content pass / a later balance sweep, not here.

## Operational

- **Base:** branch off a base that contains the D70/D71 design (commit `218e949`) — i.e. off `main`
  once that commit is merged, or directly off `claude/busy-cori-h83bpp` if it isn't yet. Re-confirm at
  build time.
- **Branch:** a dedicated `claude/<noncombat-action-substrate>`; **one commit per increment**; one PR.
- Standard commit-footer + PR-footer conventions.
- Verify with `npm run test`, `npm run build`, `npm run test:e2e`, `npm run sim`.
