# System — Substrate candidates (a transaction/command audit)

> Referenced by: [Purse journal](purse-journal.md) (the scalar→sum precedent),
> [Combat actions](combat-actions.md) (the graph→replay precedent).
> This is an **evaluation pass**, not a build. Nothing here is implemented.
>
> Status: **audit — evaluated, not started.**

## What this is

Two shipped refactors fixed the same shape: a single important value that was
**mutated inline at many sites, through divergent code paths, with no chokepoint,
no provenance, and no reconciliation invariant**.

- The **purse journal** funnelled every gold movement through one `earn`/`spend`
  chokepoint that appends a provenance entry, reconciled by `sum(log) === gold` (a
  conserved **scalar**).
- The **combat actions** substrate lowered every battle verb to a `CombatAction`
  through one `Battle.apply` interpreter that appends to `battle.log`, reconciled by
  `replay(initial, log) === state` (a **graph**, plus a label-derived RNG seam so the
  draw needs no cursor snapshot).

This doc hunts the rest of the codebase for the **same shape** and ranks the
survivors by leverage. The deliverable is the ranking + a per-candidate eval; the
recommendation at the end says what (if anything) to build next.

### The one real fork — the invariant follows the state shape

- **Conserved scalar** → `sum(log) === value`. Cheap, O(n), purely additive. (Treasury,
  RP, Morale, Influence, XP, storage counts all sit here.)
- **Graph** → `replay(initial, log) === state`. More machinery; requires the path be
  deterministic in `(initial, log)` — if a mutation draws RNG, the log must capture the
  draw coordinate (prefer `streamFor(seed, label)`, no cursor). (The deferred combat
  verbs sit here.)

The core/render split, ids-not-refs, and the "core has no `Math.random`" determinism
test (`rng.test.ts`) are respected by every recommendation below.

---

## Ranking (by leverage)

| # | Candidate | Shape | Sites / modules | Chokepoint today | Risk | Recommendation |
|---|-----------|-------|-----------------|------------------|------|----------------|
| 1 | **Guild treasury** | scalar→sum | 7 / 3 | none | low (additive) | **Build next** |
| 2 | **Rest Points (RP)** | scalar→sum | 6 / 2 | none | low (additive) | **Build next** (with #1) |
| 3 | **Morale** | scalar→sum | 5 / 4 | none | low (additive) | Build soon (most scattered) |
| 4 | **XP / leveling** | scalar→sum (per-unit) | many / 6 | `grantXp`/`grantJobXp` exist | low | Later — log only, chokepoint done |
| 5 | **Influence** | scalar→sum | 3 / 2 | `addInfluence`/`spend` (1 bypass) | low | Fold into the #1 batch |
| 6 | **Inventory / storage** | per-key scalar→sum | 9 / 6 | `addItem`/`removeItem` exist | low | Later — log only, chokepoint done |
| 7 | **Deferred combat verbs** | graph→replay | 3 verbs | partial (`Battle.apply`) | **high** (re-routes) | Later — finish the combat substrate |
| 8 | **Run-state nightly step** | graph | sparse | already ~centralized | — | **Not worth it** |

The top three (treasury, RP, morale) are the highest-leverage work: all three are
conserved scalars the purse journal's `earn`/`spend` shape already proves, all three
lack any chokepoint, and all three land as purely additive plumbing. See the
unification note after the evals.

---

## 1. Guild treasury — `guild.treasury` (scalar→sum) — **BUILD NEXT**

The purse journal explicitly defers this: *"the guild **treasury** … is a separate
currency and is *not* journaled here. The same `earn`/`spend` shape can adopt it
later."* It is the run-economy's *other* bottom line — the between-runs vault.

1. **Scattered sites — 7, across 3 modules (no chokepoint).**
   - `recruitment.ts:76` — `guild.treasury -= GUILD.mercCost`
   - `economy.ts:77` — `guild.treasury += gold` (`routePayoutToTreasury`, the one named seam)
   - `economy.ts:110` — `guild.treasury -= line.cost` (`payTreasuryUpkeep`)
   - `guild.ts:231` — `guild.treasury -= caravan.purse` (dispatch loads the purse)
   - `guild.ts:345` — `guild.treasury += purseReturned` (a returning purse)
   - `guild.ts:351` — `guild.treasury += payout` (quest payout banked)
   - `guild.ts:388` — `guild.treasury -= GUILD.mercCost` (`recruitMerc`)

   Exactly the purse's pre-refactor shape: one seam (`routePayoutToTreasury`) exists,
   six other sites bypass it and mutate the field directly.
2. **Proposed chokepoint.** `bankToTreasury(guild, amount, source, label)` /
   `drawFromTreasury(...)` — an intent-named credit/debit pair mirroring `earn`/`spend`,
   the only mutators of `guild.treasury`.
3. **Log entry shape.** `{ delta, source, label, night? }` on `guild.treasuryLog`.
   `TreasurySource = payout · purseReturn · dispatch · upkeep · recruit` (a typed
   union; `dispatch`/`purseReturn` are the caravan round-trip). Caravans referenced by
   **id**, not object ref, so the log survives a rebuild.
4. **Invariant.** `sum(guild.treasuryLog) === guild.treasury`, asserted after the
   guild-determinism / multi-run sim suite (the same place the purse invariant runs).
   No RNG on this path — pure arithmetic.
5. **Migration cost & risk — low, purely additive.** Each of the 7 sites becomes a
   thin call to the chokepoint; no gold *value* changes (exactly like the purse).
   `routePayoutToTreasury` becomes a `bankToTreasury(…, "payout")` wrapper. Suite green
   after each site. No behaviour change.
6. **Gated product feature.** A **treasury ledger / between-runs balance report** —
   "where did the vault's gold go": recruit fees vs. upkeep vs. payouts, the guild-tier
   twin of the purse's per-run ledger (D45 progressive disclosure).
7. **Leverage — highest.** Scattered (7/3) × load-bearing (the vault is *the*
   between-runs bottom line) × the cheapest possible invariant (scalar sum) ÷ near-zero
   risk (additive). It is the most direct, lowest-risk repeat of a refactor we've
   already proven works.

**Recommendation: build next.** Cleanest, highest-leverage candidate. It merits its
own short system doc *only if* built standalone — but the higher-leverage move is to
**generalize the purse journal into a reusable per-pool journal** and instantiate it
for the treasury first (see the unification note). Either way, scalar→sum.

---

## 2. Rest Points — `run.rp` (scalar→sum) — **BUILD NEXT (with #1)**

The purse journal names RP among the deferred per-run currencies. It is the run's
**healing economy** — the budget triage/recovery spends.

1. **Scattered sites — 6, across 2 modules (no chokepoint).**
   - `runloop.ts:254` — `this.run.rp += rpAdded` (nightly rest accrual)
   - `runloop.ts:272` — `this.run.rp -= res.rpSpent` (triage heal)
   - `runloop.ts:335` — `this.run.rp += rpAdded` (in-place rest)
   - `runloop.ts:346` — `this.run.rp -= res.rpSpent` (in-place triage)
   - `runloop.ts:431` — `this.run.rp += rpAdded` (camp accrual)
   - `overworld-actions.ts:369` — `run.rp -= cost.rp!` (an ability's RP cost)
2. **Proposed chokepoint.** `accrueRp(run, amount, source, label)` /
   `spendRp(run, amount, source, label)` — the credit/debit pair; `spendRp` does not
   gate (callers still check `run.rp < cost`, as today).
3. **Log entry shape.** `{ delta, source, label, night? }` on `run.rpLog`.
   `RpSource = rest · triage · inPlaceRest · camp · ability`. Plain scalar deltas.
4. **Invariant.** `sum(run.rpLog) === run.rp`, asserted across the multi-night sim.
   No RNG.
5. **Migration cost & risk — low, additive.** Mostly one module (`runloop.ts`), so the
   re-route is contained; the lone outlier is `overworld-actions.ts:369`. No RP *value*
   changes. Suite green after each.
6. **Gated product feature.** An **RP / healing-economy report** — how much rest
   income each night produced vs. how much triage/abilities drained, the
   balancing instrument for the recovery loop (is healing too cheap / too dear?).
7. **Leverage — high.** Scattered (6/2) × load-bearing (the whole heal loop) × cheap
   scalar invariant ÷ low risk. Slightly below treasury only because the scatter is
   concentrated in one module (less cross-module drift surface).

**Recommendation: build next, in the same batch as the treasury** — identical shape,
identical machinery, and the same generalized journal serves both. Scalar→sum.

---

## 3. Morale — `camp.morale` (scalar→sum) — **build soon**

Morale is the **most module-scattered** of the scalars and is genuinely load-bearing:
it feeds `safeDepthBonus` → `safeDepth` → `captureChance`/`deployNoise` in deployment
(`deployment.ts:54–171`) and the `moraleTier` gate read by the dossier/manifest.

1. **Scattered sites — 5, across 4 modules (no chokepoint, the widest spread).**
   - `node-events.ts:394` — `run.camp.morale += spec.moraleDelta`
   - `node-events.ts:549` — `run.camp.morale += PATRON.morale`
   - `upkeep.ts:162` — `camp.morale += moraleDelta`
   - `runloop.ts:277` — `this.run.camp.morale += REST.moraleGain`
   - `camp.ts:105` — `camp.morale += effect.morale` (`applyCampEffect`)
2. **Proposed chokepoint.** `nudgeMorale(camp, delta, source, label)` — a single signed
   mutator (morale moves both ways, so one signed verb, not an earn/spend pair).
3. **Log entry shape.** `{ delta, source, label, night? }` on `camp.moraleLog`.
   `MoraleSource = nodeEvent · patron · upkeep · rest · campEffect`.
4. **Invariant.** `sum(camp.moraleLog) === camp.morale`. No RNG. (If morale is ever
   clamped to a band, the clamp must live *inside* the chokepoint so the log stays the
   truth — note it, don't design it.)
5. **Migration cost & risk — low, additive.** Five thin wrappers; no morale *value*
   changes. The one wrinkle to verify: no site bypasses by *assigning* morale (none
   found — all are `+=`), so the sum holds.
6. **Gated product feature.** A **"why is morale here" readout** — the camp surface
   already nags from `journal.ts`; this turns the morale number into an explained one
   (this patron lifted it, that upkeep miss sank it).
7. **Leverage — high.** Most scattered (5/4) × load-bearing (capture odds) × cheap
   scalar ÷ low risk. Ranks just under RP because morale is a softer bottom line than
   the two gold/heal economies.

**Recommendation: build soon** — the same generalized journal again. Scalar→sum.

---

## 4. XP / leveling — `unit.xp` / `jobLevels[].xp` (scalar→sum, per-unit) — **later**

Distinct from the above: the **chokepoint already exists**. Every raise flows through
`grantXp` (`leveling.ts:107`) or `grantJobXp` (`leveling.ts:90`); callers
(`grantAbilityUseXp`, `grantCombatXp`, `commitCombatXp`, `accrueDeployedXp`,
`routeCombatXp`) all funnel there. The half the other candidates are missing — *no one
place mutates* — is **already solved**.

1. **Scattered sites — many callers, 6 modules, but already funnelled.** Grant origins:
   `traps.ts:167`, `overworld-actions.ts:400`, `economy-actions.ts:183`, `camp.ts:122`
   (ability-use), `runloop.ts:582` (combat), `runloop.ts` (`accrueDeployedXp` trickle),
   `resolution.ts`. All reach `unit.xp +=` only via `grantXp`/`grantJobXp`.
2. **Proposed chokepoint.** Already present — `grantXp`/`grantJobXp`. The refactor is
   *adding the missing provenance*, not adding a chokepoint: give them a `source`/`label`
   and append.
3. **Log entry shape.** Per-unit `{ delta, source, label, night? }` on `unit.xpLog`
   (or a run-level log keyed by `unitId`). `XpSource = combat · abilityUse · deployed ·
   objective`. Units by **id**.
4. **Invariant.** Per-unit, XP is *spent* on levels, so the conserved quantity is total
   granted: `sum(xpLog[unit]) === unit.xp + unit.level-and-jobLevel carry`. Cleaner to
   assert against a "lifetime XP" running total than the post-spend remainder — a small
   wrinkle the scalar candidates above don't have. No RNG (leveling is deterministic).
5. **Migration cost & risk — low.** Purely additive — thread a source through the two
   existing functions and their callers. No level/stat outcome changes.
6. **Gated product feature.** A **per-unit growth history** — "this character leveled
   off three node-events and a boss kill," feeding the dossier / a retrospective.
7. **Leverage — medium.** Load-bearing (progression) and cheap, but the leverage is
   halved because the *drift-prevention* win is already banked (the chokepoint exists);
   only the provenance/report value remains, and it's per-unit rather than a single
   bottom line.

**Recommendation: later.** Real value, low risk, but it buys provenance on an
already-funnelled path — less urgent than the un-chokepointed scalars. Scalar→sum.

---

## 5. Influence — `eco.influence` (scalar→sum) — **fold into the #1 batch**

Named alongside treasury in the purse doc. The chokepoint *mostly* exists
(`addInfluence`/`spendInfluence`, `economy.ts:150–171`) — **but one site already
drifts**, exactly the failure mode the invariant catches.

1. **Scattered sites — 3, across 2 modules; 1 is a bypass.**
   - `economy.ts:152` — `eco.influence += n` (`addInfluence`, the faucet)
   - `economy.ts:169` — `eco.influence -= n` (`spendInfluence`, the sink)
   - `overworld-actions.ts:368` — `eco.influence -= cost.influence!` **(bypasses
     `spendInfluence`)** — the drift the substrate would have caught.
2. **Proposed chokepoint.** Route `overworld-actions.ts:368` through `spendInfluence`
   (close the bypass), then add the log inside the existing pair.
3. **Log entry shape.** `{ delta, source, label, night? }` on `eco.influenceLog`.
   `InfluenceSource = presence · patronize · nobleVerb`.
4. **Invariant.** `sum(eco.influenceLog) === eco.influence`. No RNG. This invariant
   would have *already* failed the build on the `:368` bypass — the audit's clearest
   live example of the missing-reconciliation cost.
5. **Migration cost & risk — low.** One bypass to re-route + a log append. Additive.
6. **Gated product feature.** Folds into the Noble's standing readout (the
   `influenceTier` bands, D62) — "what built / spent your standing."
7. **Leverage — low-medium.** Small scatter (3 sites) caps the leverage, but it is
   nearly free *if batched* with treasury/RP, and it fixes a real latent bypass.

**Recommendation: fold into the treasury/RP batch** — same generalized journal, trivial
incremental cost, and it closes an existing drift. Scalar→sum.

---

## 6. Inventory / storage — `inv.counts` (per-key scalar→sum) — **later**

Like XP, the **chokepoint already exists**: `addItem`/`removeItem`
(`inventory.ts:140,147`) are the only mutators of `inv.counts`, and all 9 caller sites
route through them (`traps`, `skills`, `resolution`, `node-events`, `runloop`,
`economy-actions`). What's missing is the **storage provenance journal** — the same
gap the purse had: only the resulting counts are kept.

1. **Scattered sites — 9 callers, 6 modules, already funnelled.** e.g.
   `economy-actions.ts:136/178` (buy/sell), `resolution.ts:40` (loot recovery),
   `node-events.ts:404/552` (rewards), `runloop.ts:572` (drops), `traps.ts:164/197`
   (kit spend / salvage), `skills.ts:242` (herb spend).
2. **Proposed chokepoint.** Already present — `addItem`/`removeItem`. Add a `source`
   parameter + append, as with XP.
3. **Log entry shape.** Per-material `{ materialId, delta, source, label, night? }` on
   `inv.storageLog`. `StorageSource = loot · purchase · sale · reward · craftSpend ·
   trapKit · drop`. Materials are already id-keyed.
4. **Invariant.** Per material key: `sum(storageLog where materialId=m) ===
   countOf(inv, m)`. A multi-key scalar sum — same cheapness, one fold per key.
5. **Migration cost & risk — low, additive.** Thread a source through two existing
   functions. No count/cap behaviour changes (`canAdd` gate unchanged).
6. **Gated product feature.** A **storage provenance / "where did materials come from"
   readout** for the logistics screen, and a designer drop-rate balancing dump.
7. **Leverage — medium-low.** Cheap and additive, but (like XP) the chokepoint half is
   done, and storage is a softer balancing surface than the gold economies.

**Recommendation: later** — bundle with the XP provenance pass (both are "add a log to
an existing chokepoint" work). Per-key scalar→sum.

---

## 7. Deferred combat verbs — capture · useHeal · deployment placement (graph→replay) — **later, risky**

The **only graph-shaped survivor**, and the combat-actions doc explicitly defers it:
*"`useHeal` (consumes the shared stash) and the deployment-phase verbs are deferred from
the union."* These verbs mutate combat/run state outside `Battle.apply`'s logged path.

1. **Scattered sites — 3 verb families outside the action log.**
   - **Capture** — `deployment.ts:94–104` (`captureUnit` sets `unit.captured`), fired
     from `resolveDeployAction` and the field edge.
   - **useHeal** — `turn.ts:527` (consumes the **shared stash**, an external resource),
     wired from `BattleScene.ts:1010`. Its *turn-end* flows through `apply`; the heal
     mutation itself does not.
   - **Deployment placement** — `placeTrap` effects (`traps.ts`, `skills.ts:113`),
     partly command-shaped already.
2. **Proposed chokepoint.** Extend the `CombatAction` union + `Battle.apply` with
   `capture` / `useHeal` / `placeTrap` variants (or a sibling `DeployAction` set — the
   doc's open question), so these lower through the one interpreter like the rest.
3. **Log entry shape.** A **command**, not a delta — `{ kind: "useHeal", caster, target,
   herbId }` etc., units/herbs by **id** (ids-not-refs, the replay-rebuild requirement).
4. **Invariant.** `replay(initial, log) === state`, the existing combat invariant. The
   wrinkle: `useHeal` consumes the **shared inventory stash** (external to the battle
   graph), so replay must thread that resource; and trap **spot-rolls** use
   `streamFor(seed, label)` (already deterministic by label — no cursor), but capture
   odds during a retreat draw `rng.chance` (`deployment.ts:238`) — that draw coordinate
   must be label-derived to stay replayable.
5. **Migration cost & risk — HIGH (re-routes the loop).** Unlike the additive scalars,
   this re-routes battle/deployment paths and touches the shared stash + an RNG draw.
   The combat-actions doc flags this class as higher-risk for exactly this reason. Not a
   behaviour-preserving one-liner; gate behind the combat suite, one verb at a time.
6. **Gated product feature.** Extends **undo** to cover heal/capture/trap-placement
   (today undo is forbidden once a trap locks the turn) and full deployment-phase replay.
7. **Leverage — capped by risk.** Load-bearing and a natural "finish the substrate," but
   the high re-route risk and the RNG/external-resource wrinkles divide the score down.

**Recommendation: later** — the right way to *finish* the combat substrate, but not
behaviour-preserving plumbing; schedule it as its own risk-managed pass, not in the
scalar batch. Graph→replay.

---

## 8. Run-state nightly stepping — night · gearWear · fatigue · cooldowns — **not worth it**

Seeded as a suspect; **rejected on evidence.** This is a heterogeneous bundle of
fields, not one value mutated through divergent paths, and it is already fairly
centralized:

- `run.night` advances at just **2 sites** (`run.ts:366`, `runloop.ts:359`).
- `camp.gearWear` mutates at **1 site** (`upkeep.ts:164`, `+= 1`) and clears at one
  (`runloop.ts:282`).
- Cooldowns already have a chokepoint (`clock.ts` `tickCooldowns`/`armCooldown`).
- Fatigue spend is already a pure helper (`fatigue.ts`).

There is no single conserved scalar here and no real scatter; a "log" would be a
diary of unrelated fields with no clean reconciliation invariant. The pattern doesn't
fit. **Reject — not worth it.**

---

## Top recommendation — and the unification it implies

**Build the treasury journal next (#1), and do RP (#2), Morale (#3), and Influence
(#5) in the same pass** — they are the same shape, the same risk profile (additive,
balance-neutral, suite-green), and the purse journal already proves the machinery.

The real top-line insight: **don't write four near-identical journals.** Generalize the
purse journal's `earn`/`spend` + `sum(log) === value` into a **reusable per-pool scalar
journal** (a `{ value, log }` pair with one signed chokepoint and one fold), then
instantiate it for treasury, RP, morale, and influence. That generalization is the
single highest-leverage piece of work the audit surfaces, and it is **scalar→sum**
shaped throughout — cheap, additive, and reconciled by construction.

If a standalone doc is wanted, the **treasury journal merits its own short system doc**
(it is the between-runs economic bottom line and the most direct repeat of the purse
refactor). XP (#4) and storage (#6) are a separate, lower-priority "add provenance to an
existing chokepoint" pass. The deferred combat verbs (#7) are the graph→replay work to
*finish the combat substrate* — valuable, but higher-risk and out of the additive batch.

### One-line verdicts

1. **Treasury** — build next; scalar→sum; the cleanest repeat of the purse refactor.
2. **Rest Points** — build with #1; scalar→sum; the healing economy's bottom line.
3. **Morale** — build soon; scalar→sum; most module-scattered, low risk.
4. **XP** — later; scalar→sum; chokepoint exists, add provenance only.
5. **Influence** — fold into #1's batch; scalar→sum; nearly free and closes a live bypass.
6. **Storage** — later; per-key scalar→sum; chokepoint exists, add provenance only.
7. **Deferred combat verbs** — later; graph→replay; finishes the combat substrate but high-risk.
8. **Run-state stepping** — not worth it; no scalar, no scatter, already centralized.

---

## Utility review — is any of this actually worth building?

The ranking above scores **pattern fit and leverage**. That is the wrong question to
stop on. The harder question — *what present pain does each remove, and who consumes the
provenance* — deflates most of the list. Recorded here so the audit doesn't read as a
licence to build all eight.

### The honest yardstick the precedents set

Both shipped refactors were justified by **removing existing bad code with a waiting
consumer**, not by matching a shape:

- The purse journal **deleted `buildLedger`'s after-the-fact mis-derivation** — there
  was wrong code, and a screen (the ledger) waiting to read the right record.
- Combat actions **collapsed genuinely divergent player/AI paths** (they reached the
  primitives by different routes — a real drift bug) **and shipped undo** — a concrete
  player feature.

Each had **(a) a present-tense pain** and **(b) a consumer that justified the
substrate**. Measure the candidates against *that*, not against "is it scattered."

### Where the candidates fall short of it

- **Scatter ≠ pain.** `treasury -= mercCost` and `treasury += payout` are not divergent
  paths doing one logical op by different routes (the combat sin) — they are *distinct,
  correct* operations that happen to touch the same field. Counting 7 sites overstates
  the wound; there is no mis-derivation and no drift bug to fix, unlike the purse.
- **It adds machinery, not removes it.** The candidates replace correct one-line
  mutations with a chokepoint + log. That is net *more* code on a working path — the
  opposite of the purse/combat refactors, which retired bad code.
- **No consumer.** There is no treasury report, RP report, morale report, XP history, or
  storage-provenance screen on the roadmap. The purse journal *deferred* presentation
  and got away with it because gold is the game's bottom line; shipping **four more**
  presentation-less substrates is speculative inventory — a cost paid now against a
  payoff that may never be asked for.
- **The invariant is only a future tripwire.** `sum(log) === value` is true by
  construction; it can fail only if someone *later* adds a bypassing site. For a settled
  M9/M10 economy that rarely gains new sinks, that net catches little. (Contrast the
  purse, where the invariant retro-actively proved 11 real sites reconciled.)
- **Two candidates have nothing mechanical left to win.** XP and storage **already have
  their chokepoints** (`grantXp`, `addItem`/`removeItem`). The drift-prevention win — the
  whole mechanical point — is already banked. All that remains is speculative provenance.

### What actually carries present-tense value

- **The Influence bypass (`overworld-actions.ts:368`) is a real bug, today.** It is also
  the *only* concrete present-tense win in the list — and it does **not** need a journal.
  Route that one site through `spendInfluence` and the bug is gone. **Do this regardless;
  it is a one-line fix, not a substrate.**
- **The generalized per-pool journal is worth it only if you commit to ≥2 real
  consumers up front.** As pure abstraction ("we might want reports someday") it is
  premature — abstraction without a second instantiation is just a more expensive way to
  hold one currency. Its value is entirely contingent on a balancing-report roadmap
  existing.
- **Combat verbs (#7) are the one candidate whose payoff is a feature, not a report** —
  extending undo to heal/capture/trap-placement. That payoff is real, but so is the
  re-route risk. It is a genuine product decision (is undo-on-heal wanted?), not free
  plumbing — decide it on the feature, not on the pattern.

### Revised guidance

1. **Fix the Influence bypass now** — direct, no substrate.
2. **Do not build the scalar journals speculatively.** Treat each as a *prerequisite* to
   be pulled **when its report/feature is actually scheduled** — the substrate is real
   work only once a consumer exists. Treasury is still first *when* that day comes
   (it is the most likely report and the cleanest port of the purse), but "build next"
   should read "build next *if a between-runs balance readout is on the roadmap*."
3. **Drop XP and storage from consideration** until a growth-history / storage-provenance
   UI is concretely planned — their mechanical win is already banked, so they are
   provenance-only and the most speculative of the lot.
4. **Treat the combat verbs as a feature decision**, scheduled on the merit of the undo
   coverage they unlock, not batched with the additive plumbing.

**Bottom line: the only thing here worth doing unprompted is the one-line Influence
bugfix.** Everything else is a *well-shaped option to exercise when its consumer
materialises* — correctly identified by the audit, but not, on its own, a reason to
build. The leverage formula flattered the scalars by rewarding scatter; the value lens
says hold them as ready-to-pull designs and let a real report or feature trigger each.
</content>
</invoke>
