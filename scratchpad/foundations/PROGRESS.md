# Progress: foundations

Resume/survival file. If context is lost, this page alone should let work resume.

> **Note.** The milestone table and blocks below **lag** the current state — they are kept
> for history. Source of truth is [`decisions.md`](decisions.md): **always read to the latest
> entry** (the log is the running record of every architectural call). For the current test
> baseline, run `npm run test`. When resuming, trust `decisions.md` + `git log` over the older
> blocks below.

## Status

| Milestone | State |
|-----------|-------|
| M1 — Walking skeleton (Vite + Phaser + TS, core/render split) | done |
| M2 — Isometric grid + a unit that moves | done |
| M3 — Turn-based battle loop (CT clock + trigger bus) | done |
| M4 — Data-driven jobs & skills + phase pipeline | done |
| M5 — Signature non-combat jobs (chef / survivalist / merchant) | done |
| M5b — Logistics pillar & Deployment gamble (D6/D7) | done (gate; D9-RP/D10-intel deferred) |
| M6 — Roguelike run loop (seeded, permadeath, meta) | done (in-browser gate confirmed 2026-06-05) |
| M7 — The overworld (seeded branching run map) | done (gate confirmed 2026-06-05; terminal-ending *design* deferred) |
| M8 — The overworld action economy (camp at every node + cooldown spine + loose fatigue) | done (accepted as prototype 2026-06-06; numbers/behavior to tune later) |
| M9 — The guild & caravan tier (run.ts → a Guild of N runs) | testable (code complete 2026-06-06; awaiting in-browser gate) |
| M10 — The gold economy & recruitment (two pools get verbs + a refreshing roster) | testable (code complete 2026-06-07; awaiting in-browser gate) |
| M11 — The event-node batch (shops · recruiters · story events) | done (in-browser gate confirmed 2026-06-07; merged PR #12) |
| M12 — Combat depth, the class slice & the demo-quest proof | done (in-browser gate confirmed 2026-06-08; 325 tests green) |

States: `todo` → `in-progress` → `testable` → `done`
(`testable` = code complete, awaiting user-testable gate confirmation.)

## Current block

- **Milestone:** **M12 — Combat depth, the class slice & the demo-quest proof. DONE**
  **(in-browser gate confirmed 2026-06-08 — *The Hollow Mill* plays through end to end).**
  Built in the build-prompt's six phases on branch `claude/testability-gaps-eval-YO0Kv`.
  `npm test` **325/325 green** (269 prior + 56 new), `npm run build` clean, `core/` free
  of Phaser/DOM **and** `Math.random`. Keyboard control (Space = advance · 1–9 = abilities)
  added for fast playtesting. **This is the accepted solution-iteration checkpoint.**
  - **Phase 1 — combat-depth substrate** (`combat.ts`/`status.ts`/`clock.ts`/`skills.ts`/
    `units.ts`): **flanking** (D36 — melee-only support/pincer, `computeFlankBonus`,
    `adjacentBodies`); **statuses with teeth** (D41 — Slowed/Exposed/Hastened/Guarded + a
    `kind` classifier; read-hooks `clock.effectiveSpeed` + `combat.computeDamage`;
    `cleanseOne`/`isDebuffed`/Deadeye read `kind`); **ability economy** (D37 — `SkillDef.cost`
    charge/cooldown; charge via the clock's `ScheduledEffect` with caster-death **fizzle**;
    per-unit CT cooldowns; the maintained-stance **channel**/Mark ramp); **ranged**
    (`attackRange` stat + `inAttackRange`). Status authoring pattern graduated to
    [`docs/guides/adding-statuses.md`].
  - **Phase 2 — the four classes + Defend** (`jobs.ts`): **Heavy Knight / Hunter / Scout /
    Medic** as data (2 active + 1 passive), passives stamped + wired (tarpit aura · Deadeye ·
    solo-flank · Triage); primitives **Shove** (D19 forced move), directional **Cleave**,
    **Mark Prey** channel, charged **Mend**; the **combat↔logistics bridge** (salve/stimulant/
    antidote herbs + `resolveMedHeal` riders); **universal Defend** + reserved `standingOrder`.
  - **Phase 3 — dissolved job model + hybrid leveling** (D38/D39): `units.ts` `primaryJob`/
    `heldJobs`/`jobLevels`/`loadoutSlots`; `leveling.ts` per-job cumulative stat gains
    (+1-all + growth table), `abilityScaleBonus`, `unlockedSkills` (2nd active at job-L2),
    `routeCombatXp`, character-boon loadout growth; `isCombatant` dissolves the split.
  - **Phase 4 — scoring AI + bandit archetypes** (D42): `ai.ts` enumerate-score-pick
    (reachable-tile flood with tarpit-ring cost; flank exploit+avoid; target priority;
    fog-respecting; enemy ability use; charge-interrupt); `generation.ts` `BANDIT_TEMPLATES`
    (thug/bowman/snare-trapper/sapper/captain) + the Snare-Trapper job.
  - **Phase 5 — authoring substrate + The Hollow Mill + graded failure** (D43/D44):
    `authored.ts` (`AuthoredEncounter`/`AuthoredQuest` + deterministic builders + the
    bridge-cut **objective** whose fizzle fires on Sapper death/Immobilize; `EncounterResult`
    win|objective-failure|wipe); `demo-quest.ts` (`THE_HOLLOW_MILL` 5 beats + `DemoRunner`).
  - **Phase 6 — render** (`game/scenes/DemoScene.ts`): standalone **demo mode** (boot via the
    run-bar "▶ Demo" button / `#demo` hash) — provision screen, interactive battles with
    data-driven kit buttons (charge/cooldown readouts), **status visual trackers** (the
    `STATUS_VISUALS` registry), Defend, the **bridge-cut timer**, rest/level-up surfacing +
    the deserter choice, and graded-failure results.
  - **Gate confirmed (2026-06-08):** `npm run dev` → **▶ Demo: The Hollow Mill** plays
    through end to end (provision → flank in E1 → rest level-up + deserter choice →
    tarpit/cleanse/combo + scout in E2 → race the bridge timer / beat the Captain *or*
    fail-and-retreat in E3). Accepted as a **solution-iteration checkpoint**.
  - **NEXT:** (on go-ahead) open the PR. Then the next iteration pass — candidate threads:
    a **numbers/balance pass** (every magnitude is already a named constant/table —
    flank +4, status tunings, kit cooldowns/charges, growth weights, AI weights, the
    bridge-cut speed); **keyboard targeting** (Tab-cycle enemies) if wanted; wiring the
    four kits into the **main run/guild flow** (today they're demo-only); deeper **fog/
    ambush** (scout-reveal is a thin render seam); and the still-open run-frame queue
    (terminal-ending design, save system + lord game-over, D27).

<details><summary>M11 — The event-node batch — DONE (merged PR #12, 2026-06-07)</summary>

- **Milestone:** M11 — The event-node batch (shops · recruiters · story events): the
  overworld's third node tier (`event`) goes from **one hard-coded thief** to a
  **data-driven event registry** (D23's named "next batch"). **DONE** — in-browser gate
  confirmed 2026-06-07, merged to main (PR #12). `npm test` **269/269 green** (243 prior + 26
  new), `npm run build` clean, `core/` free of Phaser/DOM **and** `Math.random` (the grep
  test still enforces it). **Why:** M7 shipped the overworld frame with two node kinds
  (combat | rest); M10 added a third, `event`, but with **exactly one** event behind it (the
  thief, D30). M11 generalizes `event` into an **EventDef + one resolver** and ships four
  events — the thief folded in, plus shop, recruiter, story/choice. **New events are new
  records, not new branches** (D4); it **reuses M10's machinery** (shops call the Merchant
  verb, recruiters call the recruitment rolls, the thief keeps `theft.ts`) — additive, no
  new economy, no touch to the tactical core or the guild tier.
  - **What landed (M11 core, all pure/headless):**
    - `node-events.ts` — the **registry + one resolver** (D4). `EventKind`
      (`thief | shop | recruiter | story`); an `EventDef` (`id`, `kind`, `name`, `teaser`,
      `weight`, `autoResolve(run, node)`); an `EVENTS` registry + `getEvent`.
      **`eventForNode(seed, node)`** = a deterministic **weighted pick** from
      `streamFor(seed, "event:<nodeId>")` (stable per node for a seed, D22). One interpreter:
      `resolveEvent` (headless auto path via `autoResolve`), `eventChoices`/`chooseEventOption`
      (interactive), returning a structured `EventOutcome`
      (goldDelta/morale/fatigue/materials/recruited/stolen/summary).
      - **shop** — `shopStock` (seeded selection from `MATERIALS`, node-tier priced via
        `merchantPrice`), `shopBuy` reusing `merchantBuy` (purse → storage under the cap D6,
        never the treasury D34). Headless default: buy nothing.
      - **recruiter** — `recruiterOffer` (a `rollMercenary` body **node-scoped** so ids never
        collide) + `hireRecruit` (purse-debited; the body joins `run.party` immediately).
        Honors the temp↔permanent flag (D33) — a rolled body is generic/temporary; an authored
        one would join permanently (authored cast still deferred). Headless default: decline.
      - **story** — `STORIES` (authored-as-data: a prompt + 2 options, each a deterministic
        `StoryOutcomeSpec`), `storyForNode` (seeded pick), `applyStoryChoice` (mutates
        purse/morale/fatigue + drops a material reward under the cap; a `goldRoll` rolls from
        `streamFor`). Two sample beats (wounded traveler / abandoned shrine) prove the pattern.
        Headless default: take a seed-picked option.
      - **thief** — an `EventDef` whose `autoResolve` calls `theft.thiefEventSkim` (the M10
        skim folded in, blunted by Banker protection D30).
    - `runloop.ts` — `eventNode()` is now a **dispatcher** over `eventForNode` (auto-resolving
      for the headless path; used by `playCurrentNode`/`autoTraverse`); added `eventDef()`,
      `eventChoices()`, `chooseEvent()`, `recordEventNight()` for the interactive render. The
      old thief-only `EventResult` became `EventResolution { def, outcome, over }`.
    - `intel.ts` — `previewNode`'s event branch shows the **picked event's banded teaser**
      (D24), stable for a seed. Exported via `core/index.ts`.
  - **What landed (M11 render):** `OverworldScene` opens an **event screen dispatched by
    kind** — shop (buy buttons spending the purse + a Leave that records the step), recruiter
    (the offered body + Hire/Decline), story (the prompt + choice buttons → outcome), thief
    (the existing skim/recover result). **Distinct glyphs/tints per event kind** on the map
    ($ thief purple · ⚖ shop amber · ✚ recruiter teal · ? story violet) + the banded teaser on
    the preview; reuses the existing `showOverlay`/camp-button helpers.
  - **Tests (new, 26):** `node-events.test.ts` — the registry is data (≥4 events, all four
    kinds, each with an autoResolve); event-pick determinism (`eventForNode` stable for a seed,
    nodes/seeds diverge, every outcome roll reproduces); shop (node-tier price town<wild, buys
    from the purse under the cap, refuses when full/poor, headless no-op); recruiter
    (deterministic node-scoped roll, hire debits the purse + joins `run.party`, decline is a
    clean no-op, temp↔permanent honored, headless decline); story (story+choices stable for a
    seed, each option's deterministic outcome, a seeded gold roll reproduces, a pay can't go
    negative); thief regression (skims via the registry, Banker protection blunts it);
    interpreter dispatch + a full event-node map auto-traverses identically for a seed. Updated
    `theft.test.ts`'s one runloop-playing case to find a **thief-kind** event node via the
    registry (the pure `theft.ts` function tests are untouched).
  - **Seams honored (thin, full behavior later):** **narrative** = mechanical choice-events
    (data + seeded outcomes), **not** a quest-chain/dialogue engine (D23); **authored cast**
    stays the `Unit.authored` flag only — recruiters offer rolled (generic) bodies, an authored
    companion's fixed identity + recruit hooks stay deferred (D33); **shops** sell existing
    materials, no sell-back / crafting / haggling / new currency (D34).
  - **Out of scope (not built):** a dialogue/quest-chain engine; new currencies or economy
    verbs (M10 covers those); the authored companion/lord cast + data shape (D33); the save
    system + lord game-over (D27); shop sell-back / item crafting; any change to the tactical
    battle or the guild dispatch/return tier.
  - **Done (gate confirmed 2026-06-07):** a seeded run's event nodes present a shop / recruiter
    / story / thief, and replaying the seed reproduces which event fires + every number. Merged
    to main as PR #12. (Demo seed `demo-43` chains story→shop→recruiter on one path, with the
    thief on the alternate first branch — a clean replay-determinism showcase.)

</details>

<details><summary>M10 — The gold economy & recruitment — TESTABLE (code complete 2026-06-07)</summary>

- **Milestone:** M10 — The gold economy & recruitment (D28/D30/D33/D34): the two pools
  get **verbs** and the roster becomes a **loop**. **TESTABLE** — code complete
  2026-06-07, awaiting the in-browser gate. `npm test` **243/243 green** (202 prior + 41
  new), `npm run build` clean, `core/` free of Phaser/DOM **and** `Math.random` (the grep
  test still enforces it). **Why:** M8 built the overworld action economy; M9 built the
  guild tier + the structural treasury↔purse plumbing; **M10 fills that plumbing with
  faucets/sinks and the roster pool with sources** — the last of the post-M7 batch.
  - **What landed (M10 core, all pure/headless):**
    - `economy.ts` — the **two-pool routing**: `gainRunGold` (loot → **purse**,
      auto-repaying Banker debt first), `routePayoutToTreasury` (quest payout →
      **treasury** — the vault's only earned faucet), `payTreasuryUpkeep` (Upkeep = the
      treasury-side sink, reusing `computeUpkeep`), and **Influence**
      (`addInfluence`/`spendInfluence`/`canAffordInfluence`) — a purpose-bound currency
      on the guild that can **never** pay Upkeep or buy gear (D34, by construction — no
      gold sink reads it).
    - `economy-actions.ts` — the **three verbs** as data (`ECONOMY`) + resolvers:
      **Merchant ACCESS** (`merchantBuy`, purse-funded, `merchantPrice` node-tier-gated —
      rest/town < wild), **Banker TIME-SHIFT + SECURE** (`bankerEngageInterest` →
      per-node-step purse interest, `bankerBorrow` buy-on-debt, `bankerProtect` theft
      protection) — **purse-only, never the treasury** — and **Noble INFLUENCE**
      (`collectPoliticalIncome` → Influence; `bribeEnemy`/`bribeCost` reading the D24
      preview for the sway price).
    - `theft.ts` — the **active sink**: `rollSkim` (deterministic, blunted by protection),
      `thiefSteal`/`thiefEventSkim` (deduct from the purse), `recoverStolen`
      (kill-to-recover) / `thiefEscapes` (escaped-keeps-it, D13/D21). The **thief enemy
      archetype** is data in `generation.ts` `ENEMY_TEMPLATES` (`thief: true`); the thief
      **event node** is a new `NodeKind "event"` in `overworld.ts` (rare, interior),
      played by `RunLoop.eventNode()`.
    - `recruitment.ts` — the refreshing **mercenary pool** (`refreshMercPool`/`mercPool`/
      `hireFromPool`, treasury-debited, deterministic via the shared `mercCounter`) and
      the **temp↔permanent vector** (`recruitClassify`/`recruitToRoster`): authored →
      permanent join, generic → temporary (the whole new rule, D33). The authored-cast
      *data shape* stays a deferred typed seam (`Unit.authored`).
    - Wiring: loot routes through `gainRunGold` in `runloop.resolve`; purse interest
      accrues in `run.recordNight` (`accruePurseInterest`); quest **payouts** flow to the
      treasury in `guild.resolveReturn` (`Quest.payout`/`GuildRun.payout`/
      `CaravanResolution.payout`); `Guild` gained `influence`/`mercPool`/`politicsCounter`;
      `OverworldEconomy` gained `interestPerStep`/`debt`/`protection`; `Unit` gained
      `authored`/`thief`.
  - **What landed (M10 render):** `GuildScene` — Treasury **+ Influence** in the header, a
    **refreshing merc pool** (hire several) + a treasury-funded **armory buy**, and the
    **payout** surfaced on a return banner. `OverworldScene` — the camp gains the **economy
    verbs** (Merchant buy / Banker interest·debt·protect / Noble income) with live
    purse/debt/protection/Influence readouts, and the **thief event node** ($-glyph,
    purple) surfaced like rest, with a skim screen. `BattleScene` — the **thief** skims the
    purse on its turn (kill-to-recover / flees-off-map, reported in Resolution) and a
    **mid-combat Bribe** (guild Influence) flips an enemy (temp generic / permanent
    authored → joins the roster).
  - **Tests (new, 41):** `economy.test.ts` (loot→purse + debt repay; payout→treasury +
    wipe pays nothing; the treasury has **no passive faucet**; Upkeep drawn from the
    treasury; Influence walled off — can't pay Upkeep). `economy-actions.test.ts` (Merchant
    node-tier price from the purse; Banker interest on the tick / debt auto-repay / protect
    — never the treasury; Noble income → Influence; bribe reads the preview, temp generic
    vs perm authored). `theft.test.ts` (skim/recover/escape; protection blunts both vectors;
    event-node skim; determinism). `recruitment.test.ts` (pool refreshes deterministically;
    hiring debits the treasury; temp generic vs perm authored joins). Existing
    `guild.test.ts` updated for the new return payout.
  - **Seams honored (thin, full behavior later):** the **authored-cast data shape** is a
    `Unit.authored` flag only (no cast authored, D33); the **lord** game-over/save path
    stays the M9 seam (D27); **event nodes** = only the thief node the theft loop needs
    (the shops/recruiter/story batch is later, D23); **one** new currency (Influence) — no
    second (D34 restraint).
  - **Next:** confirm the in-browser gate (payouts grow the treasury / loot the purse;
    each class's one verb; a thief steals + kill-to-recover or flees, blunted by the
    Banker; the merc pool refreshes + bribe/rescue recruits; replay reproduces the
    numbers), then PROGRESS M10 → done + the M10 row in plan.md; commit/push.

</details>

<details><summary>M9 — The guild & caravan tier — TESTABLE (code complete 2026-06-06)</summary>

- **Milestone:** M9 — The guild & caravan tier (D25–D27, D32 seam): `run.ts` → a
  **Guild of N runs**. **TESTABLE** — code complete 2026-06-06, awaiting the in-browser
  gate. `npm test` **202/202 green** (173 prior + 29 new), `npm run build` clean, `core/`
  free of Phaser/DOM **and** `Math.random` (grep test still enforces it). **Why:** M7/M8
  built the per-run overworld; M9 reshapes the **container** around the run — the run
  becomes **one caravan's adventure** and a persistent **guild** owns several (D25–D27).
  M7/M8 per-run machinery (overworld DAG, camp, cooldowns, fatigue, the phase pipeline)
  is **untouched** — M9 wraps it.
  - **What landed (M9 core, all pure/headless):**
    - `caravan.ts` — the expedition vessel + the **lock ledger** (D25). A `VesselType`
      is **data** (`capacity`/`storageCap`/`speed`/`cost`; scout-cart ↔ supply-train);
      a `Caravan` bundles the four committed scarcities — **uniform** party slots
      (any character fits, capped at vessel capacity), per-caravan **storage**, **loaded
      supplies**, **locked gear**, and a **purse** (D34). `assignMember`/`lockGear`
      validate **capacity + the cross-caravan lock** (`memberRefusal`/`gearRefusal` +
      `committedMemberIds`/`committedGearIds`) so the same person/gear can't ride two
      caravans. `loadPurse`/`loadSupply`/`resetCaravan`.
    - `guild.ts` — the persistent home that **owns N runs** (D25–D27). A `Guild` holds
      the **roster pool**, the **armory**, a **pure treasury** (D34), a **stable** of
      caravans, a **never-empty quest board** (a main quest + a repeating generated
      sidequest stream — `refillBoard`), and `runs` (one `RunState` per dispatched
      caravan). `dispatch` debits the purse from the treasury, builds a deterministic
      run from the caravan targeting the quest's seed, **locks** the caravan out of the
      pool, takes the quest off the board (refilling the stream). `resolveReturn` reads
      the run's terminal: a **return** (complete) rejoins survivors, unlocks gear, flows
      the surviving purse home; a **wipe** (`isRunOver`) removes the caravan's people
      (permadeath) + loses its gear + purse while **the guild survives**, flagging
      `lordLost` if a named lord was aboard (D27 seam — no game-over built).
      `hireMercenary` is the **"never hard-fails" valve** (D27): treasury gold → a
      deterministic `rollMercenary` (`streamFor(seed,"merc:N")`) into the pool. Model C
      (D26): commitment parallel, **play serial** — the guild ticks no clock and never
      auto-resolves; waiting caravans sit untouched.
    - `run.ts` — `createRunFromCaravan(seed, caravan)` builds a run from a caravan's
      bundle (party **copy** so permadeath can't shrink the caravan, storage cap,
      supplies → inventory, purse → `camp.gold`). The existing `createRun` options
      overload is kept for tests. `camp.gold` **is** the purse; the treasury is new on
      the guild.
    - `leveling.ts` — the **D32 thin seam**: per-character `level`/`xp` on `Unit` +
      the recorded rule **"deployed grows, benched doesn't"** (`accrueDeployedXp`
      trickles only the passed-in deployed party; `grantCombatXp`/`grantAbilityUseXp`).
      The full FFT secondary-class slotting UI is a later pass (not built).
  - **What landed (M9 render):** a new **`GuildScene`** — the app's **new entry point**
    (boots first): the roster pool, the armory, the treasury, the never-empty quest
    board, a **caravan-assembly panel** (pick a vessel, fill uniform slots from the
    pool, lock gear, set the purse via a treasury→purse stepper) → **Dispatch**, and a
    **stable** showing each caravan's status (assembling / in-flight) with a **▶ Play**
    on dispatched ones. `OverworldScene` is now **one caravan's run**: its New-Run entry
    is gone (the guild dispatches it in via `RunHandoff` carrying `guild` + `caravanId`);
    on a terminal it returns to `GuildScene` (`resolveCaravanId`), which **resolves the
    return/wipe and surfaces the result** at the hall (who/what was lost/returned, purse
    reconciled). `BattleScene` threads `guild`/`caravanId` through the round-trip.
  - **Tests (new):** `caravan.test.ts` (uniform slots capped at capacity; baker-costs-a-
    warrior; the person/gear lock; purse/supplies/reset; per-caravan storage).
    `guild.test.ts` (dispatch builds a deterministic run from the bundle + locks the
    pool; N caravans in flight, played serially, **waiting ones untouched**; **return**
    flows survivors/gear/purse home + mid-run deaths don't rejoin; **wipe** costs
    people+gear+purse, guild survives, `lordLost` flag; the board is **never empty**;
    a wiped-bare guild **hires a merc** to rebuild; deterministic merc rolls).
    `guild-determinism.test.ts` (same guild seed + same dispatch choices ⇒ identical
    per-caravan maps/paths/histories via each run's own seed). `leveling.test.ts`
    (deployed accrues, **benched doesn't**; combat XP increments level; the dead don't).
  - **Seams honored (thin, full behavior later):** the **lord** loss-tier is a typed
    flag (`isLord` + `lordLost`) only — **no save/reload or game-over path** (D27 later);
    the two-pool economy is only the **treasury↔purse plumbing dispatch needs** (faucets/
    sinks/theft/Banker/Noble/Influence are M10); recruitment is only the **mercenary
    rebuild valve** (companions/lords + authored-cast data shape are M10/deferred);
    leveling is the **field-only seam** (no secondary-class slot UI — D32 later).
  - **Out of scope (not built):** the gold-economy verbs / theft / Banker / Noble /
    Influence (M10); companion & lord recruitment + authored-cast data shape; the save
    system + lord game-over/ironman; the interleaved global guild clock (model A —
    D26 keeps the path); auto-resolve of waiting caravans (rejected).
  - **Next:** confirm the in-browser gate (open the hall → assemble ≥2 caravans → lock
    gear/purse → dispatch both → play one to a terminal while the other waits → see a
    wipe cost people+gear with the guild surviving, or a return flow survivors/gear/purse
    home → re-enter the guild seed to reproduce), then PROGRESS M9 → done + the M9 row in
    plan.md; commit/push.

</details>

<details><summary>M8 — The overworld action economy — DONE (prototype, 2026-06-06)</summary>

- **Milestone:** M8 — The overworld action economy (camp at every node + cooldown
  spine + loose fatigue). **DONE** — accepted as the **prototype** for the overworld
  mechanics (2026-06-06): "a good mechanical skeleton for what we want." The menu /
  cooldown-spine / loose-fatigue **machinery** is the deliverable; the **numbers and
  behavior** (cooldown lengths, the fatigue floor/bite, the per-target Scout button
  layout) are explicitly **to be tuned later** — they're all data/constants
  (`FATIGUE` in `fatigue.ts`, `SCOUT`/`MARKET` `cost` in `overworld-actions.ts`), so
  tuning is a numbers pass, not a reshape.
  `npm test` **173/173 green** (147 prior + 26 new), `npm run build` clean, `core/`
  free of Phaser/DOM **and** `Math.random` (grep test still enforces it). **Why:** M7
  shipped the overworld as a *frame* (pick-the-next-node); M8 turns it into a true
  **second hook surface** (D29/D35) — every node opens **one unified overworld camp**
  where you take **overworld actions** gated by a per-ability **node-step cooldown**
  (the spine) and a per-character **fatigue** meter (a loose over-extension guardrail),
  then **commit** onward. The old separate Meta phase folds into this camp.
  - **What landed (M8 core, all pure/headless):**
    - `fatigue.ts` — the per-character **loose guardrail** (D35) in the codebase's
      recurring **shallow asymmetric-floor** shape (cf. deployment overdraw D7/D11,
      morale D8): a generous allowance (`floor`), **invisible in normal play**, that
      bites only past it — a *bounded* surcharge that caps, plus a demanding-action
      lock once **Exhausted**. `spendFatigue`/`restoreFatigue`/`fatiguePenalty`/
      `fatigueTier`. Lives as a `fatigue` field on `Unit` (overworld-only — **never**
      read by `clock.ts`/combat, D29's two-economies separation).
    - `overworld-actions.ts` — the **action-economy machinery** (D29/D35): an
      `OverworldAbility` is **data** (`id`/`effect`/`cost`) with a cost menu
      (`cooldown` spine + optional `fatigue`/`gold` + a **`vancian` typed stub** for
      M10/magic), a registry + `getAbility`, and one interpreter
      `takeOverworldAction` that cost-gates (cooldown **and** fatigue headroom **and**
      gold), applies the effect, spends the costs, and arms the cooldown — returning a
      result object (applied / why-refused). Per-run economy sub-state
      (`{ cooldowns, scouted }`) on `RunState`; `tickCooldowns` decrements every
      cooldown one **node-step** from `recordNight` (combat **and** rest tick it). Two
      real abilities prove the spine: **Scout** (raises a reachable node's
      `previewNode` tier via `intel.ts`) and **Market** (the Merchant's ACCESS verb —
      reuses the existing `applyCampSkill` economy effect).
    - `run.ts` — `overworld` economy on `RunState` + the node-step tick in
      `recordNight` + the economy captured in `snapshotRun` (round-trips).
    - `runloop.ts` — `restNode()` now **restores every member's fatigue** to Rested
      (rest's second job, D35); `overworldAction()` wrapper for the render; the
      unified-camp orchestration threads through unchanged combat/rest wiring.
  - **What landed (M8 render):** `OverworldScene` now opens **one unified camp** at
    every chosen node (between `choose` and play): overworld-action buttons with live
    **cooldown** ("ready" / "N nodes") + **fatigue-cost** readouts (greyed with a
    refusal reason when on cooldown / out of fatigue / out of gold), a **per-character
    fatigue meter** (banded), the folded-in meta/camp actions (Chef/Merchant skills,
    Trap Kit, Triage), and a **Commit** control → combat hands to `BattleScene`, rest
    recovers in place showing fatigue restored. `BattleScene`'s **separate Meta/camp
    screen is removed** — it now runs the silent Upkeep/RP bookkeeping then goes
    straight to Deployment → Battle → Resolution (unchanged downstream).
  - **Tests:** `fatigue.test.ts` (asymmetric floor: normal play never bites; sustained
    over-extension does; bounded/gentle bite; rest restores; **combat leaves fatigue
    untouched**). `overworld-actions.test.ts` (refuse on cooldown / when exhausted for
    demanding actions; arming + spending; node-step tick re-enables; Scout raises a
    reachable preview tier; Market moves gold/storage under the cap). `runloop.test.ts`
    (unified camp works at a combat **and** a rest node; committing a combat node runs
    the full encounter; rest restores fatigue; `autoTraverse` ticks the economy to a
    terminal). `run.test.ts` (overworld state round-trips `snapshotRun`; same seed +
    same choices + same actions ⇒ identical cooldown/fatigue trace — the determinism
    gate).
  - **Seams honored (thin, full behavior later):** `vancian?` cost key is a typed stub
    (no magic wiring — M10); Market uses the single existing gold pool + existing
    Merchant effect (no purse split / Banker / Noble / theft — M10); only the
    **overworld** camp tier is built (the guild hall is M9 — no code).
  - **Accepted as prototype (2026-06-06):** the mechanical skeleton is the deliverable;
    in-browser polish + number tuning are a deliberate follow-up (see below). The gate
    behaviors are all proven headlessly by the M8 tests.
  - **To tune later (own follow-up, not blocking):** cooldown lengths + fatigue
    floor/bite magnitudes (all constants); the per-target Scout button layout (each
    reachable node gets its own button but they share one per-ability cooldown — by
    design, possibly worth a clearer presentation); Market is job-ungated by design
    (any actor can trade) — revisit if it should require a Merchant.

</details>

<details><summary>M7 — The overworld (seeded branching run map) — DONE (gate, 2026-06-05)</summary>

- **Milestone:** M7 — The overworld (seeded branching run map). **DONE (gate)**
  (2026-06-05): `npm test` **147/147 green**, `npm run build` clean, `core/` free of
  Phaser/DOM **and** `Math.random` (grep test still enforces it). **In-browser gate
  confirmed:** started a seeded run, picked reachable nodes with intel previews
  visible, played a combat node through Camp→Deployment→Battle→Resolution and
  returned to the map (node marked visited), took a rest node to recover with no
  fight, and re-entering the seed reproduced the same map + reachable choices.
  **Deferred (own follow-up):** the **terminal-ending design** — *what* reaching the
  final node (run-complete) or dying (run-over) should **mean** (rewards, meta-
  progression, framing) is an open design question the player wants to revisit; M7
  ships **functional** run-complete / run-over screens (with the replay seed), and
  the complete-vs-wipe terminal *mechanics* are covered headlessly by tests — only
  their visual/in-browser confirmation + design polish are deferred. **Why:** through M6
  a run was a *linear* chain (`encounterIndex` + `streamFor(seed,"enc:N")`); M7 wraps
  it in a **seeded branching map** the player navigates — choosing the next mission,
  informed by intel — keeping permadeath, determinism, and the core/render split
  intact. Recruitment / shops / event nodes are a **later** batch (out of scope).
  - **What landed (M7 core, all pure/headless):**
    - `overworld.ts` — pure, **seed-driven** map generation (`streamFor(seed,
      "map")`): an `OverworldMap` of `MapNode`s (`id`, `layer`, `index`, `kind:
      "combat" | "rest"`, forward `edges`) shaped per **D22** (`MAP_GEN`: 7 layers,
      single start (layer 0, rest) + single final, interior width 2–3, banded rest
      chance, bounded fan-out). Guarantees the **connectivity invariants** (every
      non-final node has ≥1 outgoing, every non-start ≥1 incoming ⇒ every node
      reachable from the start, no dead ends). Helpers: `getNode`, `reachableFrom`,
      `isFinalNode`, and `nodeEncounter(seed, node)` =
      `generateEncounter(streamFor(seed,"node:<id>"), node.layer)` — **layer is the
      difficulty index**, reusing `generation.ts` unchanged.
    - `run.ts` (reframed) — dropped the linear `encounterIndex` for **map position**:
      `map` (the seed-built `OverworldMap`), `mapNodeId` (current), `path` (route),
      and a new `complete` terminal. Added `currentNode`, `isFinalRunNode`,
      `reachableNodes`, `chooseNode` (validates a forward choice), `isRunComplete`,
      and `recordNight` (replaces `advanceRun`: pushes a node-tagged
      `EncounterRecord`, ticks the night, flags **complete** on clearing the final
      node). `currentEncounter` now resolves from the current node. Permadeath / RNG
      / camp / inventory unchanged. `snapshotRun` now captures `mapNodeId` + `path`.
    - `runloop.ts` (extended) — `resolve()` records via `recordNight` + the complete
      check; added `reachable`/`choose` (overworld step), `restNode()` (a **no-battle**
      recovery night: Upkeep + nightly RP + a **chunk-denominated** rest bonus +
      **auto-triage** of the wounded + a morale uptick + dying-clock tick, D8/D9/D23),
      `playCurrentNode()` (combat *or* rest), `autoTraverse()` (**pick-first-reachable**
      to a terminal), and `isComplete`/`isTerminal`. `REST` is the tuning data.
    - `intel.ts` (extended, **D24**) — `previewNode(run, nodeId, extraTier?)` →
      `NodePreview`: node **kind** always shown, combat **encounter type** always
      shown, then the party's `intelFloor` reveals types→count→positions (banded as
      `readEncounter`) plus a banded `rewardHint` (`rewardBand`: hidden → band →
      `~Ng` → exact). A pure projection — **stable for a seed**.
  - **Render (`game/`):** split into two scenes. **`OverworldScene`** (boots first)
    owns the run + `RunLoop`, draws the **layered node DAG** (layers L→R, forward
    edges, kind glyphs ⚔/❄/★), highlights **reachable** nodes, shows each candidate's
    `previewNode` on hover, and commits a choice: a **combat** node hands off to
    **`BattleScene`** (now receives the run+loop via `init`, plays **one** chosen
    node's Camp → Deployment → Battle → Resolution, then **returns to the overworld**),
    a **rest** node recovers in-place with a recovery screen. The overworld owns the
    terminals — the M6-style **run-end** (seed for replay) and a new **run-complete**
    screen — and the seed bar / New Run reset stay as in M6.
  - **Tests (new/extended):** `overworld.test.ts` (same-seed identical map; seeds
    diverge; per-node deterministic encounter; start/final single; **every node
    reachable**; `reachableFrom` forward-only; no dead ends; any node reaches the
    final layer; widths in band), `run.test.ts` (map position, `chooseNode`
    advance/reject, `currentEncounter` follows the node, **complete vs wipe**
    terminals, `autoTraverse` integration, **permadeath through the map**, mid-map
    wipe, **same-seed+same-choices replay**, snapshot/route), `runloop.test.ts`
    (**rest recovers with no battle**, never stages a fight, autoTraverse
    determinism + valid forward walk), `intel.test.ts` (`previewNode` banding by
    floor, bump above the floor, **stable for a seed**, reward bands).
  - **Determinism contract:** the map derives from `streamFor(seed, "map")`; every
    combat node's content from `streamFor(seed, "node:<id>")` with **layer as the
    difficulty index** — never off a live-mutated draw order — so replay is exact
    regardless of player choices. `generation.ts`, the camp/deploy/battle/resolution
    flow, mortality/upkeep/intel/morale all stay; M7 only adds the *frame*.
  - **Next:** (on go-ahead) open + merge the PR. **Then — the run-frame's next
    batch:** the deferred **terminal-ending design** (what run-complete / run-over
    mean: rewards, meta-progression, framing), plus the rest of the queued run frame
    — **recruitment**, **shops/merchants-as-nodes**, and **event nodes** (D24's
    "next batch", out of M7 scope).

- **Milestone:** M6 — Roguelike run loop (seeded, permadeath, the full phase loop).
  **DONE (gate)** (2026-06-05): `npm test` **121/121 green**, `npm run build` clean,
  `core/` free of Phaser/DOM **and of `Math.random`** (a grep test enforces it), and
  the **in-browser gate is confirmed** — started a seeded run, played encounters
  through to a total-party loss / run-end screen, and the re-enterable seed
  reproduces the run. (A follow-up pinned the seed bar at the top of the page so
  it stays visible above the canvas.)
  - **What landed (M6 core, all pure/headless):**
    - `rng.ts` — deterministic **mulberry32** PRNG seeded from a string/number:
      `int`/`range`/`float`/`chance`/`pick`/`pickWeighted`/`shuffle`, `fork()`
      sub-streams, serialize/restore (`state`/`fromState`), and `streamFor(seed,
      label)` for reproducible labelled streams. **The one source of randomness in
      `core/`** — a grep test asserts no `Math.random`.
    - `generation.ts` — pure, **seed-driven** encounter generation: a `TileGrid`
      (8×6 + scattered blocked tiles), an **enemy roster** (data-driven
      `ENEMY_TEMPLATES`, count/stats ramp with index), encounter **type**
      (open-field/fortified, D12), and **rewards** (gold + `REWARD_TABLE` drops).
      Same seed+index ⇒ identical encounter.
    - `run.ts` — the **run state**: party roster, inventory, camp (gold/morale),
      RP pool, night counter, encounter index, difficulty id, threaded RNG,
      history; `combatRoster`/`activeRoster`, **permadeath** (`removeFromRoster`),
      `isRunOver` (wipe = no combat-capable units), `advanceRun`, `snapshotRun`,
      and deterministic `currentEncounter` (via `streamFor`).
    - `mortality.ts` — the **data-driven difficulty consequence policy** (D9), one
      per difficulty (Easy/Normal/Hard/Hardest): `resolveDowned` (full-heal /
      ½-redeploy / dying-timer / permadeath), the dying-clock (`tickDyingClocks`),
      and `resolveCaptured` → a rescue follow-up quest (window + reduced
      Deployment); `rpPerChunk` is the single recovery dial.
    - `upkeep.ts` — **Upkeep** (D15: one gold figure = Σ Food + Repairs; underfund
      a line → morale hit + worn gear) and **RP recovery** (D9: `rpPerNight` from
      data-driven role `restPoints`, `triageHeal` chunks at `RP_PER_CHUNK` →
      `CHUNK_FRACTION` max HP, `clericRevive` as a gold sink for a dying unit).
    - `intel.ts` — **banded intel** (D10): `intelFloor` from the new **Intelligence**
      stat, `scout`/`seerDivine` lanes, `readEncounter` revealing types→numbers→
      positions by tier, Tier-3 ⇒ `grantsVision` (the D18 bridge).
    - `morale.ts` — D8 **passive tiered modifiers** finally with teeth, wired into
      real systems: `safeDepth`/`placementCost` (deployment), the clock's
      `seedInitiative` bonus, gold-find — asymmetric (shallow Low floor, Speed knob
      smallest).
    - `runloop.ts` — the **orchestrator** the render drives: `camp()` (upkeep + RP
      + dying), `intel()`, `startEncounter()` (generate + build battle + place the
      combat roster on the home edge, with the rescue deployment penalty),
      `beginBattle()` (Chef heal + morale-warmed seed), `resolve()` (rewards +
      recovery D13 + auto-rescue D21 + mortality D9 + permadeath + advance; a lost
      battle ends the run), and `autoBattle()` for headless fast-forward.
  - **Render (`game/`):** `BattleScene` is now a **run driver** — reads a
    re-enterable **seed** field (index.html run-bar), walks Camp (Upkeep result +
    intel read + provision/cook/trade/triage) → on-board Deployment (morale-modified
    safe depth) → Battle → Resolution (rewards/recovery/mortality overlay) →
    **Next Encounter**, rebuilding the board from each generated encounter, until a
    wipe shows a **run-end screen with the seed** for replay. Camp-only Chef/Merchant
    (job `noncombat`) act in Meta without taking the field.
  - **Tests (new):** `rng.test.ts` (same-seed sequences, fork independence,
    serialize→restore, **no-Math.random grep**), `generation.test.ts` (same
    seed+index identical; divergence; ramp), `mortality.test.ts` (each difficulty's
    downed/captured resolution + dying clock), `upkeep.test.ts` (Upkeep total /
    underfund→morale / RP triage / cleric), `intel.test.ts` (three lanes, banded
    reveals, Tier-3 vision), `run.test.ts` (state/permadeath, **full loop to a
    wipe**, **replay reproduces the sequence**, Hardest permadeath through resolve).
  - **Next:** confirm the in-browser gate, then PROGRESS M6 → done + the M6 row in
    plan.md; commit/push; (on go-ahead) open + merge the PR.

- **(prior) Milestone:** M5b — Logistics pillar & the Deployment gamble. **DONE (gate)**
  (2026-06-05): `npm test` **74/74 green**, `npm run build` clean, `core/` free of
  Phaser/DOM, and the **in-browser gate is confirmed** — provisioned under a storage
  cap → walked a unit out in on-board Deployment and over-ranged into capture →
  brought her home (manual rescue and/or auto-rescue on victory) → recovered unsprung
  traps in Resolution. The D9-RP-recovery and D10-intel extras remain **deferred**
  (see plan.md). **Next up: M6** (seeded run loop) — pull the deferred D8-morale
  effects / D9-RP / D10-intel in alongside it.
  - **What landed (M5b):** new `core/` modules — `inventory.ts` (party-wide slotted
    stacks: `MaterialDef` with `slotCost`/`stackSize`/`recoverable`, a `MATERIALS`
    registry, storage-cap-enforced add/remove = the **provisioning constraint**, D6/D14);
    `deployment.ts` (the **push-your-luck exposure gamble**, D7/D11: Awareness-banded
    `safeAllowance`, overdraw exposure meter, deterministic capture at the threshold;
    plus `captureUnit`/`freeCaptive`/`isCaptured`); `resolution.ts` (`recoverMaterials`
    — outcome-gated whole-field recovery of unsprung+recoverable entities incl. enemy
    salvage, D13). `units.ts` gained `awareness` + a `captured` flag; `clock.ts` now
    **excludes captured units** from the seed (switched avg→**sum** so losing a unit
    *lowers* the seed, D11), ticking, and turns; `ai.ts` ignores bound units;
    `combat.ts` `battleOutcome` treats captured as non-active; `entities.ts` `makeTrap`
    now carries recovery state (`sprung`/`recoverable`/`materialId`). Render:
    `BattleScene` extends the mini-loop — **Camp** loadout (Load Trap Kit under the
    cap, Merchant raises the cap), **Deployment** with a live **exposure meter** +
    capture (token binds purple, repositions to the enemy zone), **Battle** rescue
    (move adjacent + free), and a **Resolution** overlay listing recovered materials.
  - **Tests:** `inventory.test.ts` (slots/cap/provisioning), `deployment.test.ts`
    (safe allowance, overdraw→capture, seed excludes captured + freed-unit rejoins),
    `resolution.test.ts` (win recovers unsprung incl. salvage; loss/consumed → none),
    `combat.test.ts` (+captured = non-active defender), seed-sum updates in `clock.test.ts`.
  - **Playtest adjustments (2026-06-05, → D21):** (1) **Deployment now plays on the
    board** — select a unit, **walk it out (A*) like combat**, and place traps where
    it stands; exposure became **spatial** (a banded safe **depth** from your edge,
    shown as a green zone tint; placing deeper raises the meter), replacing the
    abstract placement counter. (2) **A win auto-rescues captured allies** (control
    the field → your bound people come home); the rescue follow-up quest now applies
    only to non-win/abandon. Recorded as **D21** (refines D7/D9); 04-resolution.md
    updated. 74/74 tests green.
  - **Scoped for this pass:** the milestone's "also lands" extras — full **D9
    Rest-Point recovery / cleric revive** and the **D10 intel system** — are
    **deferred** to keep M5b on its user-testable gate; **D8 morale** is present as
    the passive tiered value/`moraleTier` (no battle modifiers yet). Flagged for a
    follow-up before/with M6.
  - **What landed (M5):** new `core/` modules — `camp.ts` (Meta state: gold,
    storageCap, morale + `moraleTier` banding (D8), a banked `pendingHeal`;
    `applyCampSkill` for Merchant `economy` / Chef `morale` effects;
    `applyCampToParty` lands the Chef heal at battle start). `skills.ts` grew
    non-combat effect kinds (`economy` / `morale` / `placeTrap`) and targets
    (`camp` / `party`); `entities.ts` gained `makeTrap` — the **first real field
    entity (D4)**: a one-shot `onUnitEnterTile` listener that damages an enemy and
    is spent (ignores its owner; forced entry fires it too, D19). `combat.ts`
    factored out `applyDamage` (sourceless damage for traps). `jobs.ts` added the
    three signature jobs — **Survivalist** (deployment: Set Trap), **Chef** (meta:
    Cook Stew → morale + party heal), **Merchant** (meta: Trade → gold + storage)
    — each hooking a *different* phase, proving the D3 seam. Render: `BattleScene`
    is now a **phase-driven mini-loop** (Camp → Deployment → Battle) on the
    `PhasePipeline`, with camp job buttons, click-to-place trap markers (that flash
    when sprung), and the Chef heal applied + animated at battle start.
  - **Tests:** `camp.test.ts` (Merchant economy, Chef morale+bank, `applyCampToParty`
    heals/caps/clears + `unitHealed`, morale bands), `events.test.ts` (+`makeTrap`
    springs once on an enemy / ignores owner), `jobs.test.ts` (+three jobs register
    under meta/deployment/battle). Each job's effect has a green test.
  - **Note (M4 DONE):** the M4 skill-button gate was confirmed in-browser; a follow-up
    fixed the skill-UI layout (hint line moved above the button band + hover-to-read
    descriptions).
  - **What landed (M4):** new `core/` modules — `skills.ts` (skills as data: a
    `SkillDef` declares its `phase`/`target`/`range`/`spend` + a **declarative
    `SkillEffect`** union — `damage` / `status` / `heal` — interpreted by
    `resolveSkill`, plus `isValidSkillTarget`), `phases.ts` (the **D3 pipeline**:
    `PHASES` Meta→Deployment→Battle→Resolution, a `PhasePipeline` cursor, and a
    `PhaseSkillRegistry` that buckets each unit's skills under the phase they
    hook), `jobs.ts` (the **data file**: the `Soldier` job with three Battle-phase
    skills — Power Strike / Hamstring / Second Wind — a `JOBS` registry, `getJob`,
    `unitSkills(unit, phase?)`, and `registerParty`). `Unit` gained an optional
    `jobId` link; `combat.resolveAttack` gained an optional attack-power override
    (for Power Strike); a `unitHealed` bus event was added. `turn.ts` gained
    `Battle.useSkill(caster, skill, target)` — the single entry the render layer
    drives. Render: `BattleScene` now reads `unitSkills(actor, "battle")` and draws
    a **skill button per skill**; self-skills resolve immediately, targeted skills
    arm-then-click-a-target, with damage/heal/status feedback and HP refresh.
  - **Why it's a clean seam:** Hamstring's Immobilized reuses the M3 status layer
    and the AI's `isImmobilized` check (a *visible* battle effect with zero new
    combat branches); the phase registry is the hook the Chef (Meta) / Survivalist
    (Deployment) plug into unchanged in M5.
  - **Tests:** `skills.test.ts` (damage > basic, heal caps at maxHp + `unitHealed`,
    status applies, target validity by side/range/self), `jobs.test.ts` (load
    Soldier by id, skills are data hooking Battle, `unitSkills` by phase, jobless →
    [], `registerParty` buckets 2×3 into Battle), `phases.test.ts` (phase order,
    pipeline advance/clamp/reset, registry buckets by phase), and a `turn.test.ts`
    case (`Battle.useSkill` resolves Power Strike and spends Act CT).
- **(prior) M5 — Signature non-combat jobs. DONE** (2026-06-05): Chef/Survivalist/
  Merchant each hook a different phase; in-browser the cooking buff healed the party
  and a placed trap sprang. Also added `docs/guides/adding-abilities.md`.
- **(prior) M4 — Data-driven jobs & skills + phase pipeline. DONE** (2026-06-05):
  skills as declarative data, the D3 phase pipeline, the Soldier's Battle-phase
  skills surfaced as working in-browser buttons.
- **(prior) M3 — Turn-based battle loop. DONE** (2026-06-05): CT clock + trigger
  bus + all seams; in-browser skirmish reaches Victory on the clock.
  - **What landed (M3):** new `core/` modules — `units.ts` (data-driven unit +
    stat block), `clock.ts` (CT clock: tick `ct += speed`, turn at `ct ≥ 100`,
    act>move spend-down, `seedInitiative` from per-side avg Speed (D11), a
    scheduled-effects queue with a `speed` gauge for charged/chained effects
    (D5/D16)), `events.ts` (typed trigger bus, D4), `entities.ts` (field-entity
    registry wired to the bus, D4), `combat.ts` (damage / defeat / win-lose),
    `status.ts` (apply/tick/expire + Immobilized + per-unit counters = the
    capture-meter shape, D12), `vision.ts` (per-side visible set + `canSee`,
    LoS stubbed, D18), `ai.ts` (move-toward-and-attack nearest, occupancy-aware
    A*), `turn.ts` (the `Battle` orchestrator the render layer drives). Render:
    `game/scenes/BattleScene.ts` — both sides drawn with HP, a CT-order panel, an
    **Advance Clock** control, move/attack animation, and a victory/defeat overlay.
  - **Tests:** `clock.test.ts` (CT order, act/move spend-down, initiative seed,
    scheduled effect resolves at the right CT + `chargeResolved`), `combat.test.ts`
    (damage/defeat/win-lose), `events.test.ts` (emit→subscribe, unsubscribe, fault
    isolation, the trivial trap entity reacts to `onUnitEnterTile`), `status.test.ts`
    (apply/tick/expire + counter), `ai.test.ts` (legal move+attack toward nearest,
    immobilized, no-enemy), `turn.test.ts` (bus enter/leave per step, trap fires on
    move, and a full BattleScene-roster skirmish runs to a decisive end — no stalemate).
  - **Seam status:** statuses+meters (D12), scheduled/charged effects (D5/D16), and
    the vision layer (D18) are all present as thin hooks exercised by tests; full
    behaviour is M4–M6 as scoped. `forced` flag on `onUnitEnterTile` lays the D19
    forced-movement primitive (a pushed unit fires the tile's entity).
- **(prior) Milestone:** M2 is done — the in-browser click-to-move gate is confirmed.
- **Design pass (2026-06-05):** captured the game's system vision in
  [`docs/design/`](../../docs/design/) (flow + 4 phase docs + 6 subsystem docs)
  and logged decisions **D4–D9**: field entities + trigger bus (D4), FFT CT clock +
  charged abilities (D5), two-tier logistics pillar (D6), the Deployment
  push-your-luck gamble (D7), **morale as passive tiered modifiers (D8)**, and
  **mortality/recovery/difficulty consequence policy (D9)**. Added milestone **M5b**
  for the logistics pillar (now also carrying camp morale + recovery). This reshapes
  M3's scope: it now builds the **CT clock** and a **trigger/event bus +
  field-entity registry** (before any entity exists), not a round-based loop.
- **Open-questions pass (in progress):** working through the design docs' open
  questions one by one. **Resolved Q1** (morale + mortality/recovery/difficulty →
  D8/D9) and **Q2** (intel: three lanes, banded tiers, new Intelligence stat, Seer
  job, banding convention → D10; new `systems/intel.md`), and **Q3** (Deployment
  exposure: two-stage spatial danger gradient, banded + shown on the board → D11),
  **Q4** (enemy-prep symmetry: A3 fortified encounters, Intel/Awareness
  detection, Act-cost disarm, and the Snare → unified in-combat capture → D12), and
  **Q5** (material recovery → D13), **Q6** (inventory: party-wide slotted stacks +
  "wide logistics, micro at the unit" → D14), and **Q8** (spoilage → **dropped** in
  favor of **Upkeep**: gold as the solvent for maintenance chores, with funded/
  underfunded Food + Repairs lines, gear-condition replacing equipment durability,
  and debt → morale → desertion → D15), and **Q9** (entity combos: no merging —
  **chain via the bus**, scheduling reactions onto the CT clock with a `speed`
  (instant→timer); provisional → D16). **The main open-questions list is now
  COMPLETE — decisions D1–D16 recorded; design spine done.** **Parked for a dedicated
  discussion: Ammo** (per-unit vs pool + the "empty ranged feels bad" balance; the
  wide-logistics principle leans it toward a shared pool; carries the conditional
  Survivalist salvage perk). Future-tagged: Snare adjacency-accelerator variant;
  per-unit morale lever; the "Intelligence" stat rename. **Next concrete build step
  is M3** (CT clock + trigger/event bus + field-entity registry), now well-specified
  by D4/D5/D11/D12/D16.
- **Session play-trace (COMPLETE):** walked a full game session (start → camp/upkeep
  → intel/provision → deploy → combat → result → overworld) to stress-test the spine.
  Verdict: across ~30 beats **nothing contradicted a decision**; the only change was
  an improvement (D11 → per-step auto-retreat). Strongest validations: **Vancian
  magic** makes spells a *logistics axis* (provision/expend/recover like ammo); a
  relic (**cast-iron pan, −2sp cooking upkeep**) proved D15's "gold-as-solvent" lets
  items plug into one Upkeep line; **push-into-traps** showed unit-driven combos
  (D16 spirit). **Surfaced batch to design next:**
  - *Declared (confirm & record):* ✅ **Vancian magic → D17** (scribed castings/day
    re-allocatable to pre-deploy + refresh on rest; scrolls as storage consumables;
    a free **default spell** floor; runes are Vancian via reagent cost + deploy peril;
    Vancian ⟂ charge-time; **consumables family** = ammo+scrolls+reagents, partial
    recovery on win). Still to record: **relics/special items**; **currency
    denominations** (gold + silver); **XP/leveling** exists.
  - *Open — combat-core (touch M3):* ✅ **fog-of-war/vision → D18** (symmetric;
    Hidden→Pinged→Seen ladder; sight=radius+LoS, Awareness ping=presence-no-identity
    ignoring LoS; ghosts; ambush from Hidden; Tier-3 intel grants starting vision;
    stealth-as-trait deferred; new `systems/vision.md`). ✅ **forced movement → D19**
    (push/pull, banded, involuntary, target-agnostic; forced entry onto an entity tile
    fires it; stop at blockers + optional collision damage; vision rules apply).
    ✅ **Ammo → D20** (basic arrows **infinite** = archer's default-spell twin; special
    arrows are limited consumables; every consumable carries a **recovery keyword**
    (N% on a win), Survivalist perk boosts it — refines D13/D17). **COMBAT-CORE BATCH
    COMPLETE.**
  - *Open — run frame:* **branching mission select** + the **overworld↔camp**
    relationship; **recruitment** of party members; **intel pre-selection scope**
    (reveals comp + rewards + recruits across options).
  - *Open — content patterns:* **enemy traits↔counters** (flying/Grounded, nets/
    runes); **class deploy abilities** (Rogue infiltration past the safe zone).
  - *Confirmed consistent:* freed units cold-join the CT clock; temporary statuses can
    be escaped/expire (allies free from snares, enemies self-free from nets); entity
    durability partial-loss; intel banding scales reveal depth.

</details>

- **Frontier (post-M12):** the demo-expedition line is well past the M12 table above — read
  `decisions.md` **to D97**. The Hollow Mill's back half is the Wave-0 arc: two topology-exclusive
  arms (**sustain**/Medic · **infiltration**/Thief, D92) that now converge on a **real dual-OR
  finale — The Prison Assault (D97/#169)**: win by **storming the garrison** (`eliminate-all`, any
  party) **OR** by **extraction** (a Thief picks the cells + escorts the prisoners to the exit).
  C2 (OR-victory) is built as the reusable `isGoalKind` split (goals OR'd, constraints AND'd) + a new
  `extraction` objective kind; the `STUB_FINALE` is retired.
- **Current frontier (2026-07-17 — branch `claude/verify-memento-plugin-a7u52w`):** two threads past D97.
  **(1) Tooling — the level editor + content pipeline (D98):** `#editor` (paint a level, Download JSON) →
  `content/levels/*.json` glob-loaded → `#level=<id>` plays it; a `level-author` agent + drift-free
  single-sourcing. **(2) The finale as a RESCUE (D99, refines D97):** free a **group of captives**, dual-OR
  kept (extraction = the heart, eliminate-all = also completes it). Built standalone as
  `content/levels/the-rescue.json` (`#level=the-rescue`) — **not yet in the arc**; the live finale stays
  D97's `PRISON_ASSAULT`. **Read [`finale-authoring-handoff.md`](finale-authoring-handoff.md) + D97–D99
  before changing the finale.** Guards green: tsc · vitest **1166** · build · e2e (`test:e2e:level`,
  `:editor`, + the D97 scenario/arc/second-battle suites).
- **Editor soft-play (D112, 2026-07-19 — branch `claude/level-editor-soft-play-7yuirj`):** a **▶ Playtest**
  control in the editor's Scenario tab boots the live draft into the **real BattleScene** (deploy the squad,
  watch the AI, feel the spacing) and returns to the editor with the draft intact — no export→drop-in→reload
  loop. Generic `RunHandoff.returnTo` scene-key + a persistent "✎ Exit Playtest" button; a flexible
  **squad picker** (`game/playtest.ts` `PLAYTEST_PARTIES`, default the small standard trio) so a
  class-tailored board can be fielded with the right cast. Guard: `test:e2e:editor:playtest`.
- **Editor local persistence (D113, 2026-07-20 — same branch):** the working map **autosaves** to
  `localStorage` on every edit and **restores on reload** (a `restored` flag skips re-restoring on a
  playtest return), plus a **named library** in the Scenario tab (Save/Load/Delete · New blank) so previous
  attempts survive across sessions. Raw-draft storage (lossless, incl. in-progress), `sanitizeDraft` fail-
  safe so a corrupt/stale blob boots blank, Load is undoable. A `memento:challenge` pass caught + fixed a
  boot-freeze on a parseable-garbage blob (objectives/reward now deep-sanitized) and same-id save clobber
  (explicit "save as" name). `game/editor-storage.ts`; guards `editor-storage.test` (+9) +
  `test:e2e:editor:persist` (18). Browser-local — Download .json still commits keepers.
- **Deferred / next (see the handoff doc):** rename the placeholder captives into named characters; the
  **flank / repositioning session** (the Intel deploy-side that makes extraction viable — red-teamed,
  kept-not-replaced, C5-lite); the **map-creation expansion** (bigger/richer boards + more of the
  `AuthoredEncounter` surface in the editor + import + maybe a map/topology editor — the owner's stated
  next direction); then **promote The Rescue into the arc**. Older queue: status-model (#171), save-model (#117).
- **Blockers:** none.

<details><summary>Stale footer (M2-era notes, kept for history)</summary>

- **Last green sha:** M2 landed `core/grid.ts` (TileGrid: dimensions +
  per-tile walkability + 4-connected neighbours) and `core/pathfinding.ts`
  (A* over the grid, Manhattan heuristic, returns a `GridCoord[]` or `null`),
  plus `game/IsoScene.ts` rebuilt to draw an 8×8 iso grid with blocked walls,
  one unit, and click-to-move that animates along the A* path.
- **What landed:** `npm test` → 14/14 green (3 iso + 5 grid + 6 pathfinding,
  covering a straight path, routing around a blocked tile, no-path-exists, and
  start==goal); `npm run build` typechecks + bundles; `core/` verified free of
  Phaser/DOM imports.
- **Next step:** begin M3 per the design pass — the **FFT CT clock** (per-unit CT
  by Speed, turn at CT≥100, Move + Act, charged-ability scaffolding; D5), a
  **trigger/event bus + field-entity registry** built before any entity exists
  (D4), attack/damage, win/lose, an advance-clock control, and a basic enemy AI.
- **Note:** npm "latest" is now Phaser 4; we deliberately pinned Phaser 3 (`^3.90.0`)
  to honor decision D1. Revisit as a tracked pivot if we ever want Phaser 4.
- **Blockers:** none.

</details>

## Closeout

Filled in only when the feature is finished. `archive-feature.sh` REFUSES to
archive until this section is complete.

- **Graduated to:** <commit body | architecture doc | README | nothing (spike) | memento (workflow asset improved)>
- **Archived:** <no | yyyy-mm-dd>
