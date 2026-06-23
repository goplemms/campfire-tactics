# Build prompt — Deployment ↔ Combat substrate unification + a game-wide skill `usableContext` axis

> **Status:** ready to dispatch (design reviewed against the code; build brief).
> **Decision to author:** **D67** (latest committed is **D66**; the Scout per-class pass
> then takes **D68**). Confirmed against `scratchpad/foundations/decisions.md` — no D67 exists yet;
> re-confirm at build time if ordering changed.
> **Supersedes the framing of** `scratchpad/foundations/deployment-combat-unification-plan.md`
> (the D63 plan, phases 1–3 done). This brief *finishes* that work (the clock fold) **and** widens
> the skill-surfacing unification to all four game contexts.

## Goal (one line)

Make **pre-combat (deployment) and combat run on ONE shared substrate**, and make **every place a
unit can act** (overworld, guild, pre-combat, combat) surface its skills from **one projection**.
Only genuinely **phase-specific** functionality is layered on top.

## The scope rule (the whole point — read twice)

> **Pre-combat and combat share *all* functionality, minus anything explicitly required for a
> phase-specific thing. Skills declare *where they can be used* as data; the UI surfaces and gates
> them from one function in every context.**

- **SHARED by construction (unify these):** movement (one verb; budget = `effectiveMove`, so
  Swift/Hastened buffs apply in both), the **CT clock** (one clock — the enemy "front" folded in as
  a first-class scheduled actor, not a parallel clock), statuses, entities/traps, **action-surfacing**
  (data-driven from the unit's skills filtered by *context*), the action log / undo / replay, the
  **RNG seam**, the per-turn loop controller, and the **skill-cast path**.
- **PHASE-SPECIFIC (keep as a thin layer ON TOP — do NOT dissolve these):**
  - **Pre-combat layer:** the campfire safe-radius, the enemy **danger-front** and its per-turn
    growth, the **capture roll** on the front's turn, **Dig In**, the deploy **risk forecast**, and
    the **alarm → battle** transition. The front is the deployment layer's *actor*; capture is its
    *on-turn effect*; the alarm is its *transition*.
  - **Combat layer:** **engagement** — attacks and offensive skills do not fire during stealthy
    pre-combat (they would raise the alarm); **win/lose** detection (`battleOutcome`); the **AI** (the
    player sneaks in deployment; the only deployment "AI" is the front advancing — the capture-wave
    layer, not a `Unit` AI).

Everything not on the phase-specific list is shared. When in doubt, **share it** and justify any
exception in the decision record.

### Sharing policy decision (confirmed with the owner)

- **Permissive default — "share all but engagement."** A skill is usable in **both** board contexts
  (pre-combat + combat) unless it is *engagement* (offensive / aimed at a foe), which stays
  **combat-only** because of the stealth/alarm invariant. So **movement** (Reposition, Dash),
  **support** (heals, cleanse, guard-allies), and **self/ally buffs** (Defend, Swift-style) all
  become pre-combat-usable; **attacks / offensive status** stay combat-only; **traps** stay
  pre-combat; **camp** skills (morale) live in the overworld.
- **Wire all four contexts now.** The axis spans the whole game: `overworld | guild | pre-combat |
  combat`. Overworld camp-skill surfacing migrates onto the shared projection; the guild context is
  defined and seam-wired now as a **forward-looking placeholder** (it surfaces no per-unit skills
  today — see audit #10).

> **Blast-radius note (intended, must be tested, not silent):** the permissive default changes the
> *availability* of several shipping abilities — **Hunter `reposition`**, **Scout `dash`**, the
> universal **Defend**, and every **heal/cleanse/guard-allies** become usable in pre-combat. This is
> the mandate working as designed, but it is a real, player-visible change: pin it with deployment-
> context tests (increment 3/6). If pre-combat clutter from a *no-op* ability (e.g. Defend with no
> incoming damage yet) is unwanted, trim **per-skill** with an explicit `usableContext: ["combat"]`
> — do not special-case it in the renderer.

## Project invariants (non-negotiable)

- **Pure core / render split (D2):** all logic in `src/core/` — no Phaser, no DOM, **no
  `Math.random`** (every roll flows through a seeded stream). `src/game/` is the thin renderer; flag
  render changes separately from core.
- **Determinism:** the headless sim must stay **byte-identical** where behavior shouldn't change
  (`src/core/sim.ts`; re-run equality is `sim.test.ts:57`, `expect(b.summary).toEqual(a.summary)`).
- **Green at every increment:** `npm run test` (**645 today**, +new), `npm run build` (`tsc --noEmit
  && vite build`), and `npm run test:e2e` (`scripts/e2e-deploy-battle.mjs`) all pass after **each**
  increment, not just at the end. Each increment is **self-contained and individually reversible**.
- **Decision-driven:** cite **D63** (the turn-substrate unification this *finishes* — its roadmap,
  `decisions.md:1865-1866`, named the clock fold as phase 2 and it was never done; phase 3, the
  action log, has since landed), **D3** (`phase` stays the pipeline tier; the new `usableContext`
  axis layers over it), **D5** (the CT clock), **D2** (core/render). Secondary: D7/D11 (capture-wave
  origin), D60 (free-move combat turn whose budget read deployment will now match), D64 (telegraph),
  D35 (the overworld action economy whose `usesPerNode`/cooldown gating the context filter must
  preserve), D41 (the universal Defend that Dig In mirrors).

## Current state — the audit (verified against the code 2026-06-23; build on it)

The **data** substrate is shared (units, entities, capture/rescue state, the `Battle.apply` action
log, undo, replay — D63 phase 3 landed). What's still **forked** is the **execution**, the
**vocabulary**, and the **skill-surfacing**. Each confirmed:

1. **Movement budget forks.** Combat reads `effectiveMove(actor)` (`combat.ts:105` = `moveRange +
   Swift`) at `BattleScene.ts:979` & `:1693` (core mirrors `battle-flow.ts:73`,
   `planning.ts:39/55/86/110`). **Deployment reads raw `actor.moveRange`** in *two* places — the
   execution clamp `BattleScene.ts:815` and the capture-risk forecast `BattleScene.ts:2098`. The
   deploy *clock* already honors `effectiveSpeed` for timing (`deployment.ts:529`), so ignoring Swift
   for the *movement budget* is an internal contradiction, not just a deploy-vs-combat gap. (5 sites
   use the `isImmobilized(u) ? 0 : effectiveMove(u)` ternary — collapse into one `moveBudget(u)`.)
2. **`deployMove` is a parallel verb to `move`** (`combat-actions.ts:61`, dispatched `turn.ts:406-411`,
   wrapper `:624`) — both call the identical `execMove(unit, path, false)`. The distinct `kind` is
   **load-bearing for replay**: `replay()` (`turn.ts:725-727`) drains the leading `isDeployAction`
   verbs (`DEPLOY_KINDS = {deployMove, digIn, placeTrap, capture}`, `combat-actions.ts:73-78`) before
   `battle.seed()`. **Keep the verb distinct; only the *budget* unforks.**
3. **There is NO replay-safe skill-cast verb for deployment (new finding — F1).** A movement/support
   ability applies its effect via `{ kind: "skill" }` (`combat-actions.ts:54`) — the only verb that
   runs `resolveSkill`. `"skill"` is **not** in `DEPLOY_KINDS`, and `replay()` drains *only*
   `isDeployAction` verbs before `seed()`. So casting (say) Dash *during deployment* via the plain
   `skill` verb would make the drain stop at it and re-apply it as a **post-seed combat** action →
   **replay/determinism corruption.** Deployment today has *no* generic skill cast (only
   `digIn`/`placeTrap`/`deployMove`), and `onSkillButton` has no deployment branch. ⇒ a dual-context
   ability cannot be *cast* pre-combat as the substrate stands. **Fix: a drained `deploySkill` verb
   (increment 5).**
4. **Surfacing is forked across contexts and not as "data-driven" as it looks.**
   - **Deploy row** is a bespoke enum: `deploy-flow.ts:69` `deployActions(ctx)` returns from
     `{undo, digIn, placeTrap, startBattle}` (`DeployActionId`, `:46`); `placeTrap` gated by an ad-hoc
     `canTrap` computed inline at `BattleScene.ts:631`. Movement isn't in the list (separate
     click-to-move).
   - **Combat row** is *partly* data-driven: `showSkillButtons` (`BattleScene.ts:1097`) iterates
     `unlockedSkills(actor, "battle")` (`:1110`) **but then hardcodes a `DEFEND` append** (`:1167`)
     plus conditional **Bribe / Search / Disarm** (`:1135/1151/1159`). So combat is *not* a pure
     `unlockedSkills` projection — it is `unlockedSkills` **+ a universal hardcode + conditional
     non-skill verbs**.
   - **Overworld row**: `OverworldScene.campRecoveryActions` (`:560-584`) iterates
     `unitSkills(u, "meta")` into a "Recovery" drawer (one row per unit×skill), plus a separate
     **Triage** action. Only **one** meta skill exists today (Chef `cook-stew`, `jobs.ts:145`).
   - **Guild row**: none. `GuildScene` is pure logistics (recruit/dispatch/resolve); no per-unit
     skill buttons exist.
5. **`SkillDef.phase` is singular** (`skills.ts:23` `Phase = "meta"|"deployment"|"battle"|"resolution"`,
   `:189` `phase: Phase`); filtering is single-valued (`unitSkills` `jobs.ts:467-471`, `unlockedSkills`
   `leveling.ts:220-223`). No representation for "available in more than one place," and **`meta`
   conflates overworld and guild** (two distinct surfaces under one phase) — itself an argument for a
   separate, finer axis.
6. **Capture is deployment-only and correctly so** (`deployment.ts:364` `frontCaptureChance` / `:378`
   `captureChanceAt`, rolled in `resolveFrontTurn` `:452`, invoked on the net's turn
   `BattleScene.ts:503`; `Battle.capture` `turn.ts:644`; `dugIn` set `turn.ts:414`, cleared in
   `execMove` `turn.ts:466`). This is the capture-wave *layer* — keep it.
7. **Two clocks (the big structural fork).** `DeployClock` (`deployment.ts:511`) is a full second
   clock beside `CTClock` (`clock.ts:139`). They share the stepping engine (`tickUntilReady`
   `clock.ts:75`) and comparator (`byReadiest` `clock.ts:60`), but `DeployClock` re-implements
   `seed/tick/ready/next/spend` (+ `spendFront`). The **front is not a `Unit`** — it's a `DeployFront`
   (`deployment.ts:306`, an interface) the scene holds separately (`BattleScene.ts:233/448`).
   `CTClock.advanceToNextActor` returns `Unit|null` only — no non-unit/tempo-source concept exists
   yet, so the fold is genuinely new surface area.
8. **Two scene turn-loop controllers.** Deployment: `deployNextActor` (`BattleScene.ts:463`) →
   `DeployClock.next()`. Combat: `onAdvance` (`:948`) → `battle.nextActor()` → `advanceOutcome`
   (`battle-flow.ts:44`). Separate per-turn flag sets (`deployMoved/deployActed` `:238/239` vs
   `moveBudget/acted/actCharged/movedThisTurn/turnLocked` `:260-268`).
9. **Two scene-owned RNG streams (worse than "one extra" — F4).** Combat draws via `Battle.roll(label)`
   (`turn.ts:206`, keyed by `(seed,label,draw#)`). The scene owns **two** streams *outside* that
   system: `deployRng = streamFor(seed,"deploy")` (`:429`, used for the front capture roll `:503`)
   **and** `spotRng = streamFor(seed,"trap-spot")` (`:430`, trap spotting). Both must fold for "one
   RNG seam" to be true.
10. **The front's tie rule is deliberate policy.** `DeployClock.next()` lets the front act only on a
    **strict CT lead** (`deployment.ts:556`, `this.frontCt > best.ct`); players win ties; the comment
    `:544-545` names this as the reason the front is a distinct actor. **Any clock fold MUST preserve
    this exact rule.**

## Target unified model

**Combat is the substrate. Deployment = the same `Battle` turn substrate + the capture-wave layer +
a restricted, data-declared action vocabulary. All four contexts project their skill row from one
function.** Five sub-decisions:

### A. Skill availability → a game-wide `usableContext` axis, defaulted from the skill's shape

Add `type UsableContext = "overworld" | "guild" | "pre-combat" | "combat"` and an optional
`usableContext?: UsableContext[]` on `SkillDef`, with a **pure `skillContexts(skill): UsableContext[]`**
that defaults from the skill's shape so authors rarely write it. Keep the **owner's vocabulary**
(`pre-combat`/`combat`, not the code's `deployment`/`battle`) for the axis — it is genuinely a
*different* axis from `phase` (note `phase:"meta"` splits into both `overworld` and `guild`), so a
distinct vocabulary is correct, not a synonym.

The default keys off **`effect.kind` + `target` + `spend`** (effect kind alone is insufficient — a
Swift self-buff and an enemy debuff are *both* `kind:"status"`):

```ts
function skillContexts(s: SkillDef): UsableContext[] {
  if (s.usableContext) return s.usableContext;                  // authored override wins
  // movement — spends the move budget to self-buff: shared across both board phases
  if (s.spend === "move" && s.target === "self") return ["pre-combat", "combat"];
  switch (s.effect.kind) {
    case "placeTrap":                                  return ["pre-combat"];
    case "morale":                                     return ["overworld"];      // camp skill
    // engagement — offensive / aimed at a foe → combat only (alarm)
    case "damage": case "cleave": case "forced-move": case "channel":
                                                       return ["combat"];
    case "status":                                                                 // friend/foe split
      return s.target === "enemy" ? ["combat"] : ["pre-combat", "combat"];
    // support — non-engagement board help → shared across both board phases
    case "heal": case "med-heal": case "triage-heal": case "cleanse": case "guard-allies":
                                                       return ["pre-combat", "combat"];
  }
}
```

This is **total over all 12 effect kinds** (`damage, heal, status, channel, triage-heal, cleanse,
forced-move, cleave, med-heal, guard-allies, morale, placeTrap`). Keep `phase` as the **pipeline
tier** (D3) for back-compat and for `meta`/`resolution` skills' interpreter routing; `usableContext`
is the *board/screen-surface* axis layered over it. Skills stay **pure data** (an array, not a
predicate — serializable/testable), and the move-vs-engage-vs-support-vs-deploy-vs-camp rule lives in
**one** default function.

Add `availableSkills(unit, context: UsableContext)` (in `leveling.ts`/`jobs.ts`) = the level-gated
job skills **plus the context-appropriate universals** (`DEFEND` for combat, `DIG_IN` for pre-combat),
filtered by `skillContexts(s).includes(context)`. **Keep `unlockedSkills`/`unitSkills` as thin
back-compat shims** (callers `ai.ts:208`, `traps.ts:96/110`, `battle-flow.ts:77`); migrate call sites
incrementally. Combat calls `availableSkills(actor, "combat")`; deployment `availableSkills(actor,
"pre-combat")`; overworld `availableSkills(u, "overworld")`; guild `availableSkills(u, "guild")`.

### B. Movement → one budget read (`effectiveMove`) in both contexts

Change the two deploy reads (`BattleScene.ts:815` clamp, `:2098` forecast) from `actor.moveRange` to
`effectiveMove(actor)`. The core `deployMove` verb already walks any given path via `execMove` (no
core change for the budget). Add a single `moveBudget(u) = isImmobilized(u) ? 0 : effectiveMove(u)` in
`combat.ts` to collapse the repeated ternary at the five sites.

### C. Action surfacing → every context row is `availableSkills(unit, ctx)` + a thin per-context extras set

All four rows derive their **ability** buttons from `availableSkills(unit, ctx)` — the *same*
construction. **Fold the universals into `availableSkills`** so `DEFEND`'s hardcoded combat append
(`BattleScene.ts:1167`) **dies** and `DIG_IN` flows the same way (no `canTrap` special case). Model
**Dig In as a universal pre-combat capability** (a `DIG_IN` `SkillDef` mirroring `DEFEND`,
`jobs.ts:411`, `usableContext: ["pre-combat"]`); it **surfaces** via `availableSkills` but **executes**
via the existing `digIn` verb (just as `placeTrap` surfaces as a skill but executes via its verb, and
a combat skill surfaces but executes via the `skill`/`cleave` verb). (Optional cleanup: promote
`dugIn` to a real status so `DIG_IN` resolves through `resolveSkill` exactly like `DEFEND` — not
required.)

**Honest scope of the symmetry:** the *skill* portion of every row becomes one projection differing
only by the context string. Each context keeps a **thin set of non-skill extras** as scene/decision
buttons: combat → Bribe / Search / Disarm + the green primary; pre-combat → Undo + Start Battle;
overworld → Triage + the Recovery drawer chrome. Those are field interactions / meta-controls / phase
commits, not abilities — they are *not* dissolved into the skill axis.

### D. Clock → fold `DeployClock` into `CTClock` (front as a strict-lead-tie tempo source)

Finish D63's phase 2. Make the front a participant on the **one** `CTClock`: add an optional registered
**tempo source** (`{ ct, speed, strictLeadTie: true }`) that ticks alongside units and is returned by
`advanceToNextActor` when it leads — preserving the **strict-lead tie rule (#10)** as a clock-policy
flag. The clock owns *when* it's the front's turn; the capture-wave layer (`resolveFrontTurn`) still
owns *what* the front's turn does (grow the radius, roll capture). Retire `DeployClock`; keep every
capture-wave function in `deployment.ts`. **Highest determinism risk — land it behind the golden-trace
guard (increment 0) and last.**

### E. One cast path → a drained `deploySkill` verb (the F1 fix that makes "functional in both" true)

Add `{ kind: "deploySkill"; unit; skill; target }` to `CombatAction` and to `DEPLOY_KINDS` — the
drained twin of the combat `skill` verb, exactly as `deployMove` is the drained twin of `move`. Route
it through the same `resolveSkill` path; `replay()` then drains a pre-combat skill cast **before**
`seed()`, so a dual-context ability is *castable* pre-combat **without** corrupting replay. Then
**consolidate the RNG (#9):** route **both** the front capture roll **and** the trap-spot roll through
`Battle.roll(label)` so deployment randomness rides the battle's draw-coordinate system. And **unify
the scene controllers (#8):** drive the deploy per-turn loop off `battle.clock` / the shared
`advanceToNextActor` so `deployNextActor` and `onAdvance` become one parameterized path differing only
by context (most falls out of the clock fold; finish the per-turn flag-set merge).

## Build plan — ordered, tested increments

> `[CORE]` = `src/core`, `[RENDER]` = `src/game`. Green test/build/e2e after **each**. One commit per
> increment (reviewable/revertible).

- **0 — Characterization safety net** `[CORE]`. Golden trace: pin, for one fixed seed + scenario, the
  exact deploy turn order (unit ids + front turns) and the capture outcome (snapshot
  `DeployClock` + `resolveFrontTurn`). Add a test asserting today's deploy reach == `moveRange` (so
  increment 2 is a visible change only under a buff). Snapshot today's overworld camp-skill surfacing
  per unit (for increment 7's parity). No production code.
- **1 — `UsableContext` + `skillContexts` default fn** `[CORE]`, pure/additive. `skills.ts`. The 4-value
  type, the optional `usableContext` override, the permissive default. Unit-test **every** effect kind
  × `target` × `spend` combination's default. No call sites change.
- **2 — `effectiveMove` in deployment** `[RENDER]`. `BattleScene.ts:815` & `:2098`; add `moveBudget(u)`
  in `combat.ts` and collapse the five ternaries. Update the increment-0 reach test to expect the
  buffed extension. **This is the movement fix the Scout's Dash rides.**
- **3 — `availableSkills(unit, context)`** `[CORE]`, pure/additive. Job skills + context-appropriate
  universals, filtered by `skillContexts`. Parity tests: `availableSkills(_, "combat")` reproduces
  today's combat skill set (`unlockedSkills(_, "battle")` **+ Defend**); `availableSkills(_,
  "overworld")` == today's `unitSkills(_, "meta")`. **New deployment-context assertions** pinning
  exactly which skills now surface in pre-combat (Reposition, Dash, Defend, heals, cleanse,
  guard-allies — the blast radius). Keep `unlockedSkills`/`unitSkills` as shims.
- **4 — `DIG_IN` universal + combat row consumes `availableSkills`** `[CORE]`+`[RENDER]`. Add `DIG_IN`
  (`jobs.ts`, `usableContext: ["pre-combat"]`). Rebuild `showSkillButtons` to source its skill buttons
  (incl. Defend) from `availableSkills(actor, "combat")`, **dropping the hardcoded `DEFEND` append**.
  Bribe/Search/Disarm stay conditional extras. The `digIn`/`placeTrap` verbs stay; only surfacing
  moves.
- **5 — Drained `deploySkill` verb (F1)** `[CORE]`. `combat-actions.ts` (`+kind`, `+DEPLOY_KINDS`),
  `turn.ts` (dispatch through `resolveSkill`; wrapper). Test: a self-buff cast in deployment logs a
  `deploySkill`, `replay()` drains it before `seed()`, golden trace byte-identical. **This is what
  makes a dual-context ability *castable* pre-combat.**
- **6 — Deploy row derives from `availableSkills`** `[CORE]`+`[RENDER]`. Shrink `deploy-flow.ts`
  `deployActions`/`DeployActionContext` to meta-controls (Undo, Start Battle); rebuild
  `refreshDeployButtons` (`BattleScene.ts:626`) from `availableSkills(actor, "pre-combat")`; wire each
  skill's click to the right verb (`deploySkill` for self-buffs/heals; the `digIn`/`placeTrap` verbs
  for those). **`canTrap` dies.** Deploy and combat rows are now one projection + a thin per-context
  extras set.
- **7 — Overworld row derives from `availableSkills`** `[RENDER]`. Swap
  `OverworldScene.campRecoveryActions`'s `unitSkills(u, "meta")` → `availableSkills(u, "overworld")`.
  Parity vs the increment-0 snapshot. **Preserve** `usesPerNode`/cooldown/XP gating (orthogonal — the
  filter only decides context membership).
- **8 — Guild context (placeholder)** `[CORE]`+`[RENDER]`. Add `"guild"` to the axis; add a no-op
  `availableSkills(u, "guild")` seam in `GuildScene` for future per-unit guild actions. **Honest:
  surfaces nothing today; ~zero risk; infrastructure, not a feature.**
- **9 — Telegraph/forecast for dual-context abilities** `[CORE]`+`[RENDER]`. Thread a `context` into
  `ability-forecast.ts` (`forecastSkill`/`abilityFootprint` are battle-only today — no phase param) so
  a dual-context movement/support ability's preview resolves in **pre-combat** too. The deploy **risk**
  forecast (`deployForecast`, capture-wave) stays its own layer.
- **10 — Fold `DeployClock` into `CTClock`** `[CORE]`+`[RENDER]`, the determinism gate. `clock.ts`
  (tempo source + `strictLeadTie`), `deployment.ts` (retire `DeployClock`, keep the wave functions),
  `BattleScene.ts:236/449/465/544`. **Golden trace must be byte-identical**; `deployment.test.ts` (79
  cases) green; `npm run sim` summary unchanged; e2e green. If the trace diverges, the tie rule or
  seed fold is wrong — **revert this increment alone** (1–9 still deliver the user-visible goal).
- **11 — RNG consolidation (BOTH streams, F4)** `[CORE]`+`[RENDER]`. Route the front capture roll
  **and** the trap-spot roll (`deployRng` + `spotRng`) through `Battle.roll`. Golden trace stays
  stable.
- **12 — Scene controller unification** `[RENDER]`. Merge `deployNextActor`/`onAdvance` into one
  context-parameterized per-turn loop (most falls out of 10; finish the flag-set merge). Behavior
  unchanged; e2e green.

**Recommended (was "optional"):** extend `sim.ts` (which skips deployment, `:13`) to exercise the
deployment substrate, so the headless re-run-equality guard (`sim.test.ts:57`) covers deployment
determinism — today the **only** automated guard for the clock fold is the increment-0 golden trace.
If it proves expensive, note as follow-on; do not block.

Increments **1–9 fully unblock a dual-context ability** across overworld/pre-combat/combat at
low-to-moderate risk; **10–12 complete the "share everything" mandate** (the deep clock/RNG/controller
convergence). Land 10–12 last and behind the golden-trace guard, each revertible.

## Completeness checklist (do not open the PR until every box is true)

- [ ] All 10 forks from the audit are either **unified** or **explicitly justified as a phase-specific
      layer** in the decision record.
- [ ] A **movement** ability is available + functional (castable, replay-safe) in *both* board
      contexts (budget honors `effectiveMove`); a **support** ability is usable in both; an **attack**
      is combat-only; **Set Trap / Dig In** are pre-combat-only; **camp** skills are overworld — all
      via `skillContexts` defaults, no per-ability special-casing (overrides are data, not renderer
      branches).
- [ ] The **blast-radius** abilities (Reposition, Dash, Defend, heals, cleanse, guard-allies) have
      explicit deployment-context tests pinning their new availability.
- [ ] **One cast path:** a dual-context ability cast in pre-combat logs a drained `deploySkill` verb;
      `replay()` reconstructs byte-identically across the phase boundary.
- [ ] Every context row is built from `availableSkills(_, ctx)` (no `canTrap` left; no hardcoded
      `DEFEND` append); the per-context **non-skill extras** (Bribe/Search/Disarm, Undo/Start Battle,
      Triage) remain as scene/meta controls.
- [ ] **Overworld** surfacing migrated (parity with the snapshot); `usesPerNode`/cooldown/XP intact.
- [ ] **Guild** context defined + seam-wired (surfaces nothing today — documented).
- [ ] One clock; the **front's strict-lead tie rule is preserved** (golden trace byte-identical).
- [ ] One RNG seam (**both** front capture **and** trap-spot ride `Battle.roll`).
- [ ] One per-turn controller path (deploy/combat differ only by context).
- [ ] D64 **telegraph** resolves for a dual-context ability in pre-combat; the deploy **risk** forecast
      still works (capture-wave layer intact).
- [ ] **AI** remains combat-context only (no deployment-unit AI introduced).
- [ ] **Capture-wave layer intact:** campfire/front/growth/capture-roll/Dig In/alarm→battle all still
      work; `deployment.test.ts` green.
- [ ] `npm run test`, `npm run build`, `npm run test:e2e`, `npm run sim` all green/stable at **every**
      increment.
- [ ] (Recommended) sim exercises the deployment substrate, or it's noted as follow-on.
- [ ] The **Scout job kit is untouched** (see Boundaries) — note: `skillContexts` makes the *existing*
      Dash dual-context as a substrate effect; that is allowed, the kit data is not edited.

## Decision record + glossary

- **Author the decision** (`scratchpad/foundations/decisions.md`): title ≈ *"Deployment as
  combat-substrate + capture-wave layer + a game-wide skill `usableContext` vocabulary (finishes
  D63)."* Capture the scope rule, the **permissive sharing policy**, the five sub-decisions (A–E), the
  four-context vocabulary (and why it's distinct from `phase` — `meta` splits into overworld/guild),
  the explicit phase-specific layer list, the guild-as-placeholder note, and cite
  D63/D3/D5/D2/D7/D11/D60/D64/D35/D41. Confirm the number (D67 unless ordering changed; Scout pass then
  D68).
- **Update the systems docs** (`docs/design/02-deployment.md`, `03-combat.md`, and the phase line in
  `docs/design/README.md`): note that deployment and combat share one substrate, and that skills
  declare `usableContext`.
- **Glossary** (`docs/design/glossary.md`): add the Layer-1 keyword **Dig In** (deployment: hunker for
  reduced capture chance; ban synonyms "Hunker"/"Brace" — note "Brace" already collides with Defend,
  `glossary.md:250`). Add a short note on the **`usableContext`** axis / the four surfaces, and that
  deployment keywords (Camp alert, Cover, Captured, Trap Kit) name the **capture-wave layer**, not a
  separate engine. **Swift** keeps its single canonical meaning — it just now applies pre-combat too.

## Boundaries

- **Do NOT design or modify the Scout job kit** (passive "Quiet Footsteps", "Set Trap", "Dash"). That
  is the **D68 per-class pass** on top of this unification. Your only obligation: ensure the substrate
  cleanly supports a **dual-context movement ability**. Note the `skillContexts` default *does* flip
  the already-shipping `dash` (and Hunter `reposition`) to dual-context — that is the substrate working
  as intended, **not** a kit redesign; do not add the Scout's capture-reduction, the passive merge, or
  the trap-rider swap.
- Pure-core-first; flag every `src/game/` change separately from core.

## Operational

- Work on a **dedicated branch** off current `main`, **one commit per increment**, open **one PR to
  `main`** at the end. Do **not** push to the Scout branch (`claude/practical-brahmagupta-vqoxbp`) —
  it rebases onto this once merged.
- Commit-message footer per repo convention; standard Claude Code footer on the PR body.
- Verification: `npm run test`, `npm run build`, `npm run test:e2e`, `npm run sim`.

---

### Changelog vs the prior brief (what this revision changed and why)

1. **Sharing policy made explicit & permissive** ("share all but engagement") — owner decision; the
   blast radius (Reposition/Dash/Defend/heals/cleanse/guard-allies become pre-combat) is now named and
   test-gated, not silent.
2. **Axis widened to the whole game** (`overworld | guild | pre-combat | combat`) with the owner's
   vocabulary — owner decision; justified because `phase:"meta"` splits into overworld + guild.
   Overworld surfacing migrates (trivial swap, increment 7); guild is an honest placeholder
   (increment 8).
3. **New sub-decision E + increment 5 — the drained `deploySkill` verb** (F1). Without it, a
   dual-context ability either isn't castable pre-combat or **breaks replay's pre-seed drain**;
   "functional in both contexts" was previously unachievable.
4. **Surfacing symmetry corrected** (F3): combat's row is *not* a pure `unlockedSkills` projection —
   `DEFEND` is a hardcoded append + Bribe/Search/Disarm are conditional. Universals now fold **into**
   `availableSkills` (Defend's hardcode dies); the "same projection" claim is restated honestly as
   "same skill projection + thin per-context extras."
5. **RNG fork is two streams, not one** (F4): `deployRng` **and** `spotRng` both fold (increment 11).
6. **Accuracy fixes:** `deployment.test.ts` is **79** cases (not 74); baseline is **645** tests;
   `ability-forecast` is battle-only and needs a `context` param (increment 9); `sim` extension bumped
   from optional to recommended (it's the only ongoing deployment-determinism guard besides the golden
   trace).
