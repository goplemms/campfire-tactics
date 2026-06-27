# The Hollow Mill — Demo Expedition

The framework's first authored expedition (**D44/D52**), redesigned as a
**mechanics-teaching vertical slice**. It is the demo: a single hand-built run that
introduces the core systems in order, from camp to a stub finale.

> **Source of truth for data:** [`src/core/hollow-mill.ts`](../../src/core/hollow-mill.ts)
> (topology, encounters, cast, rewards) and the pinned events in
> [`src/core/node-events.ts`](../../src/core/node-events.ts) (`provision-choice`,
> `merchant-town`). This doc codifies the **intent** — per-node goals and route
> changes — so the data and the "why" stay in sync. When they diverge, the code wins;
> update this doc to match.

## What the slice covers

The expedition is a layered DAG the player branches through. The built slice runs
from **camp (L0) through the Layer-6 offshoots** and reaches a **stub finale (L7)** so
the run is completable. **Layers 6–10 are not designed** — the finale is a placeholder
holdout, not the authored ending.

## Topology (locked)

```
  L0 Camp ─► L1 Skirmish+Cook ─► L2 Camp(pick-one) ─► L3 Sapper's Snares
     ─► L4 FORK { 4A Rest (no Medic) | 4B Prison Wagon (frees Medic) }
     ─► L5 Market (hub — Merchant) ─► L6 { Secured Wagon (Medic catch-up), Den (relic) }
     ─► L7 stub finale
  edges: 4A→Market, 4B→{Market, Den}, Market→{Secured Wagon, Den}, {Wagon, Den}→finale
```

| Layer | Node id | Kind | Name | Edges |
|---|---|---|---|---|
| L0 | `start` | rest | Provisioning camp | `e1` |
| L1 | `e1` | combat | Skirmish at the Mill Yard | `camp2` |
| L2 | `camp2` | event | Camp on the Road | `snares` |
| L3 | `snares` | combat | The Sapper's Snares | `rest4a`, `wagon4b` |
| L4A | `rest4a` | rest | Rest (no Medic) | `market` |
| L4B | `wagon4b` | combat | The Prison Wagon | `market`, `den` |
| L5 | `market` | event | Market Town | `securedWagon`, `den` |
| L6A | `securedWagon` | combat | The Prison Wagon, Secured | `finale` |
| L6B | `den` | combat | The Thieves' Den | `finale` |
| L7 | `finale` | combat | The Mill (stub) | — |

## The cast

Starting trio — **Soldier-only front line**, visibly missing a healer/support, which
motivates the three recruits across the run:

- **Edrin** / Soldier (lord) — the anchor.
- **Rook** / Hunter — ranged.
- **Vale** / Scout — the party's **eyes + field-craft** (D10). High Intelligence (7)
  floors intel at tier 2 (deploy edge live; a single Scout can reach tier 3 to blow a
  hidden ambush); high Awareness (5) **spots the node-3 concealed snares**.

Recruits join via their nodes (not the starting bundle):

- **Pip the Cook** — an **on-board captive** at **L1**: he starts the fight bound in the
  captor's corner and is freed by the **rescue mechanic mid-fight** (then controllable) or
  by **winning the field**; he joins permanently. Opens the camp economy (Cook Stew / RP).
- **Sela the Medic** — freed at **L4B** *or* the **L6 Secured Wagon** (authored post-win
  grant); opens sustain.
- **Mira the Merchant** — recruited at the **L5 Market** (event); opens markets.

**Starting bundle:** purse 120 · supplies `salve×2, stimulant×1, antidote×2` ·
storage cap 8 · morale 2 · difficulty normal.

---

## Per-node goals

Each node carries one **teaching beat** — the mechanic it exists to introduce or test.

### L0 — Provisioning camp (`start`, rest)
**Goal:** the pre-deployment logistics surface before a single blow. Spend the opening
purse, load supplies. No combat.

### L1 — Skirmish at the Mill Yard (`e1`, combat)
**Goal:** the first fight *and* the first rescue, taught as **one literal shape**.
- **Teaches:** the CT clock (C1) + flank/isolation (C2), with the rescue mechanic on top.
- **Design:** winnable raw by the no-healer trio. Main cluster is two bodies (Thug,
  Bowman); the **cutthroat captor sits apart in a corner** (col 7,row 0), and **Pip starts
  on the board as a bound captive beside him** (col 7,row 1). The flank affordance and the
  Pip-rescue affordance are the *same corner* — **isolating the captor IS the rescue**.
- **The captive (D52, replaces the old silent grant):** Pip is a real player-side token
  from turn one — *visible* during deployment (a captive is not a concealed enemy), **grey/
  bound**, off the initiative clock, and **safe from the AI while bound** (a captured unit
  is not an active target, so he can't be killed before he's freed). Reaching and **freeing**
  him mid-fight (the existing capture/rescue Act) makes him a **controllable party unit for
  the rest of the fight**; he is added to `run.party` on the win.
- **Win-recruit guarantee:** winning the node **always** recruits Pip — even if you never
  reached him (the captors fell), and even if a freed Pip was downed afterward (demo-
  friendly: a won node always delivers the recruit). He joins as a fresh body that **banks
  the encounter's completion XP** (the objective `reward.xp` every survivor gets), so he
  arrives **leveled with the party** (primary-job L2 here), not at base. He earns only that
  flat win XP, not the per-unit combat-event tally — he wasn't a tracked combatant.
- **L1 tuning is preserved:** the fight stays winnable **raw, without freeing Pip**. A bound
  (or freed-then-downed) Pip is a bonus, never a requirement, and can never make the node
  unwinnable or fail it (a captive is off the clock, not a target, and not a required
  objective).
- **Reward:** 60g, 1 salve, 100 XP — XP tuned so every survivor's primary job reaches
  **L2 (the 2nd-active unlock)** right after this fight.

### L2 — Camp on the Road (`camp2`, event → `provision-choice`)
**Goal:** the first **scarcity choice** and the Cook payoff. No combat.
- **Pick-one** (two finds, room for one):
  - **Trap Kit** — reusable snare for Vale's field-craft (gated on storage room); prep
    for L3.
  - **Iron Weapons** — party-wide **+attack that decays** without a smith (sets the
    `iron-weapons` flag; rides gear-wear).
  - **Cook a Stew** — *only if Pip is alive* — banks **+2 RP** (the L1 rescue paying
    forward).
- **Teaches:** logistics-as-choice; reusable utility vs. decaying power; the recruit
  economy compounding.

### L3 — The Sapper's Snares (`snares`, combat)
**Goal:** a **strong-field / weak-enemy** encounter — the threat is the terrain.
- **Design:** one lone bandit (`lone-straggler`); the real encounter is **five strong
  concealed snares** mid-field (concealment 4–6, damage 22–26). High damage so eating
  an unspotted one really stings (no Medic yet). **Spot-and-avoid** — disarm not
  required.
- **Teaches:** you win or lose in the **pre-combat setup** — read the field with Vale's
  Awareness, position so the lone enemy is fought on your terms.
- **Reward:** 70g, 1 trap-kit, 70 XP. Unsprung kits salvage to the stash.
- **Branches:** this node is the **L4 fork** — edges to both 4A and 4B.

### L4 — The fork
- **4A · Rest (`rest4a`, rest):** the safe road. Recover in place, **no Medic**. → Market.
- **4B · The Prison Wagon (`wagon4b`, combat):** the hard road. A tougher **slaver
  escort** — a softened captain (`slaver-lieutenant`, the *introduction* to the elite
  tier, maxHp 34 / atk 10 / def 3) + a detail — fought **before you have a healer**
  (tense by design, winnable raw). **Reward:** 120g, 2 salve, 80 XP. **Grant:** Sela
  the Medic is freed + sets `medic-freed`. → Market *or* Den (skip-edge).
- **Teaches:** risk/reward routing — the Medic is gated behind the hard road, with a
  later catch-up if you skip it.

### L5 — Market Town (`market`, event → `merchant-town`)
**Goal:** the economy hub every road reaches; the guaranteed Merchant beat.
- **Grant:** Mira the Merchant joins; opens the market at the `basic` tier.
- **Teaches:** markets / trade; the third recruit; the reconvergence point both fork
  paths share.

### L6 — The offshoots
- **6A · The Prison Wagon, Secured (`securedWagon`, combat):** the **Medic catch-up**
  for players who took 4A. **Alert, dug-in captors** (higher Awareness — they resist the
  scout's free read) who have **laid their own snares** (concealment 5–6, damage 16–18)
  — the **node-3 lesson inverted** (avoid *enemy* traps). Slightly richer (140g) because
  it's harder. **Grant:** Sela + `medic-freed`. **Gate:** inaccessible once the Medic is
  already held *(party-state gate — currently STUBBED; see Open items)*.
- **6B · The Thieves' Den (`den`, combat):** the **relic** offshoot, reachable from 4B
  and the Market. **Thief enemies skim the purse and bolt** for the edge — kill them to
  drop the gold; let them escape and it's gone (stealth in play). **Reward:** 90g, 1
  valuables, 70 XP. **Grant:** `relic-hollow-blade` *(placeholder unique — effect TBD)*.
- **Teaches:** 6A = the inverted trap read + the catch-up safety net; 6B = theft/chase
  tension + build-defining loot.

### L7 — The Mill (`finale`, combat) — **stub**
A minimal holdout (captain + two thugs) so the run completes. **Not the authored
finale** — replace when L6–10 are designed.

---

## Route changes & feel passes (log)

Recent work that altered routing or the within-node experience. Newest first.

- **Top-strip rework: phase/turn to the corner, objectives as a check-list box** (D-feel,
  render-only — layout revisit). The old centred "situation strip" (one title line over a
  shared objective + intel row) was cleared to evaluate a bare top, then rebuilt deliberately:
  the **phase + whose turn** heading (with the deploy global state — net reach / safe radius /
  kits) moved to the **top-left corner**, and the objectives became a **vertically stacked
  check-list box** (far-left, directly under the phase/turn line — a left-column "mission" stack
  above the focus card — styled like the action box) — one row per staged objective with
  a left-hand status marker (green **✓** met · red **✗** failed · muted **○** pending, the live
  **%** appended for a timed one). The box now **includes the default "Defeat all enemies"
  goal** (previously left implicit), so it's always populated and reads as a real checklist, and
  it shows in **both** phases (`refreshDeployStatus` + `refreshHud` call it). The **intel recap**
  (tier · foes · types · shape) stays hidden behind a one-flag `SHOW_INTEL_RECAP` restore — the
  remaining piece still looking for a home. Seams: `BattleScene.refreshObjectives` (replaces the
  old `refreshObjectiveText` / `layoutSituationLine`), `objectiveObjects` layer. Pure render; no
  core touch. Guarded green: tsc, 837 unit tests, build, deploy→battle e2e (62, incl. the
  objectives-box assertions), sim (summary **unchanged**).
- **A dug-in unit reads as "out of action" — minimal Take Action menu** (D-feel + a small
  status-trigger change). Dig In is a deployment brace (lower capture chance, at the cost of
  the turn) whose stance **persists across turns**, but a dug-in unit's next turn used to open
  to the *full* deploy row — nothing signalled that the player had deliberately sat it out. Now
  a unit that **opens a turn already dug in** (distinguished from one that just dug in this turn
  by `deployActed`) shows a single **Take Action** verb in place of the row, beside the usual
  End Turn / Start Battle — so the intentional hold reads from the UI. **Take Action** stands it
  back up into a normal turn (reveals the full row via a per-turn `deployReveal` flag) *without*
  breaking the stance; the dig-in capture benefit now holds until the unit actually **moves**
  (already cleared in `moveUnit`) or **commits an act** (cleared in the deploy act seams —
  `commitFieldAct` / `placeTrap` — the "on action" trigger, modelling dig-in like a status
  effect). As a QoL shortcut, the reach stays lit and **clicking a tile to move** re-engages a
  dug-in unit directly (the move clears the stance) — Take Action is the no-move path back in;
  either way an Undo rolls it back to the dug-in turn-open. Render + a contained scene-side
  status trigger; the capture roll is live-only and the headless sim never digs-in-then-acts, so
  determinism is untouched. Seams: `BattleScene.takeAction` / `deployReveal`; the act-clear in
  `commitFieldAct` / `placeTrap`. Guarded green: tsc, 837 unit tests, build, deploy→battle e2e
  (60, incl. the minimal-menu / reveal / benefit-holds assertions + `dug-in-minimal-menu` /
  `dug-in-take-action` screenshots), sim (summary **unchanged**).
- **Obstacles are raised 3D blocks, not flat tile-markers** (D-feel, render-only). An
  impassable tile used to be a **flat diamond** in a different colour (`tileBlocked`) — the
  same shape and read as the translucent **capture-zone washes** (safe/danger/neutral),
  so a wall and a zone tint were easy to confuse. Obstacles now render as a **raised
  isometric block**: a lit top face floating a block-height above the tile plus the two
  visible (down-left / down-right) side faces shaded progressively darker, outlined for a
  crisp silhouette — so an obstacle reads as a *solid standing in the world*, distinct from
  any tile overlay. `drawGrid` now paints in two passes — the flat checker floor for every
  tile, then the blocks **back-to-front** (`col + row` ascending) so a nearer block occludes
  the one behind it. The blocks sit on the grid layer (depth 0); zone washes already skip
  non-walkable tiles, so nothing tints them. Pure render; no core touch (the grid's `blocked`
  data is unchanged). Seam: `CombatView.drawGrid` / `drawObstacle`; palette `COLOR.obstacle*`.
  Felt on every board with interior cover — the Hollow Mill encounters scatter 1–3 blocked
  tiles each. Guarded green: tsc, 837 unit tests, build, deploy→battle e2e (55), sim
  (summary **unchanged**).
- **Turn-controls split out of the unit-action box** (D-feel, render-only). The bottom-left
  command menu used to stack *everything* in one box — **Undo** leading, the unit's verbs
  (skills / Search / Disarm / Dig In / Defend / Bribe / place-trap) in the middle, and the
  green **End Turn / Advance Clock** primary docked as the bottom slot — so "what this unit
  does" and "control the turn/clock" shared one column and read as one undifferentiated list.
  They're now **two stacked boxes** with a gap: the unit's **verbs** on top, and a separate
  **turn-control box** below. The control box stacks any full-width control rows (**Start
  Battle**, deploy) above a **bottom row** that pairs **Undo** *side-by-side* with the clock
  primary as equal halves. During a unit's turn **Undo is persistent** — it sits there from
  turn-open, **greyed/inert** until there's something on the stack, then lights up after the
  first move/act — so the take-back is a visible affordance, not a button that only appears
  once you've already acted. (The primary is, and always was, *one* button that flips **End
  Turn** ↔ **Advance Clock** by state; since Undo is only live *during* a player turn, it
  only pairs with End Turn — between turns there's no active unit to undo, so Undo is omitted
  and Advance Clock keeps the full width.) This mirrors the taxonomy
  [`systems/actions.md`](systems/actions.md) already draws — *Undo / Advance Clock / Start
  Battle* are "pure UI/flow controls that carry no game decision," distinct from the
  state-changing verbs — so the layout now matches the model. Both phases share it
  (`layoutActionMenu(verbs, { undo, controls })` lays the verb box via `drawMenuBox` and the
  control box via `drawControlBox`; the primary reflows full-width ↔ half-width via a new
  `Button.setWidth` that refreshes its hit area; a disabled `ActionSpec` renders greyed +
  inert through `makeTextButton`, keeping its hover-hint). Pure render; no core touch, no
  key/verb change (Space / W / Esc unchanged). Seam: `BattleScene.layoutActionMenu` /
  `drawControlBox`, `Button.setWidth`. Guarded green: tsc, 837 unit tests, build, deploy→battle
  e2e (55), sim (summary **unchanged**).
- **L1: Pip is a real on-board captive — "isolating the captor IS the rescue"** (D52 — a
  deliberate *behavior* change). The L1 Cook no longer joins via a **silent post-win grant**
  (`E1_SKIRMISH.grants: { recruit: PIP_COOK }`); he now **starts the Skirmish bound on the
  board** in the corner the cutthroat guards (Pip at col 7,row 1, captor at col 7,row 0), so
  the **flank corner and the rescue corner are literally the same tile**. The player frees
  him mid-fight with the **existing** capture/rescue Act (reach him, then Free) — after which
  he's a **controllable party unit for the rest of the fight** — or the **win frees/recruits
  him** even if never reached (the captors fall). He joins permanently either way. New
  **reusable data seam**: `AuthoredEncounter.captives?: { spec, pos }[]` (a future on-board
  Medic can use it), inflated by `buildAuthoredCaptives` and injected at battle assembly
  (`stageEncounter`) as a **player-side, `captured: true`** token — *outside* the roster
  reset, so he stays bound, off the CT clock, and never an AI target (the win check + foe
  lists count only active units). Recruit-on-win lives in `RunLoop.resolveCaptiveRecruits`
  (win-only, idempotent), folded into the resolution's "Freed by winning the field" line; the
  bound token is released on a win so the board reads coherently under the report. **L1
  tuning is preserved**: the fight is still **winnable raw by the no-healer trio without
  freeing Pip** — a bound (or freed-then-downed) Pip can never make the node unwinnable, fail
  it, or perturb determinism (he draws no RNG). Core/render split kept (the
  state/transition is core; only tint/placement/hint is render). Guarded green: tsc, 836 unit
  tests (incl. new captive-staging + E1 captive-recruit/invariant tests), build, deploy→battle
  e2e (54, incl. "Pip is bound at the corner during deployment and can be freed" + the
  `02-captive-bound`/`03-captive-freed` screenshots), sim summary **unchanged**.
- **One weighted move step for the whole board** (D-feel, internal — fixes a real drift).
  Deployment and battle still ran **parallel** move methods (`deployMove` / `playerMoveStep`)
  over **two** budgets (`deployMoveBudget` / `moveBudget`) that had drifted apart: deployment
  clamped and spent by **raw tile count**, while battle — *and deployment's own reach wash +
  forecast* — used the **weighted** reach cost. So a cost-changing effect (the Heavy-Knight
  tarpit ring, D42, which costs extra to *enter*) was charged pre-combat in the wash a player
  read but **not** in the step they actually paid, and the deploy forecast didn't match the
  deploy clamp. Both phases now run one `moveStep(actor, tile, ctx)` over the **one**
  `moveBudget`, charging the **weighted** cost of each leg from the same `reachByKey` the wash
  is drawn from — the spend and the read can no longer diverge, in either phase. Deployment is
  consequently **click-within-reach** like battle (the lit wash already showed exactly the
  legal tiles). The after-step still branches by phase (`afterDeployMoveStep` relights the
  smaller reach + chains click-ahead; `afterBattleMoveStep` keeps the D60 turn open or ends
  it), and the deploy reach **data** folds onto the shared `reach`/`recomputeReach`
  (`deployReachByKey` / `recomputeDeployReach` retired) — only the wash's own graphics layer
  stays separate, because deployment paints zone washes the battle preview never draws past.
  Pure render; no core touch, no rules/economy change (one Act per turn, same total range).
  Seam: `BattleScene.moveStep`. Behavior-preserving for normal ground; the *intended* change
  is that tarpit-ring tiles now cost the same to step onto in deployment as in battle. Guarded
  green: tsc, 832 unit tests, build, deploy→battle e2e (46, incl. the weighted deploy-reach
  assertion), sim unchanged.
- **Med-heal works in both phases — the Medic can pre-heal in staging** (D67 W8). The last
  combat-only board skill joins the rest: the herb-stash heal is now a `pre-combat` + `combat`
  skill, so the demo Medic (who joins mid-run) can spend a carried herb to patch a wounded unit
  *before* the fight, not only during it. The two-step herb pick (choose salve/stimulant/
  antidote → click a wounded ally) is one shared `openHerbMenu(actor, skill, ctx)` helper that
  reuses the existing `armTargetedSkill` arming, so the combat and deploy flows are the same code
  — only the per-phase aim read differs. The cast routes through the same `useHeal` verb in
  either phase (resolve + arm cooldown + spend the herb; the deploy clock owns the turn, so no
  CT). The only remaining default that's still combat-only is **charged** (a CT-clock mechanic
  with no deploy equivalent) — that one is genuinely phase-native, not UX. *Caveat, shared with
  combat:* med-heal resolves outside the action log (`useHeal` → `resolveMedHeal`, not `apply`),
  so it isn't undoable/replayable in **either** phase — a pre-existing gap deploy inherits, not a
  new one; making med-heal a logged action would close it in both at once (a separate change).
  Guarded: full suite (832, incl. a new pre-combat med-heal test — heals, spends the herb, no
  CT), e2e (46, the refactored combat herb-menu unbroken), sim (unchanged).
- **The engagement axis is gone — combat in pre-combat is allowed, just untargeted** (D67 W7,
  internal — byte-identical for current content). Engagement is no longer a *per-skill phase
  rule*; it's *board state*. `skillContexts` no longer classifies attacks as combat-only — every
  board skill (offensive or support) is usable in both phases — and the interpreter's old
  `usableContext` refusal is replaced by one target check: a skill aimed at a **concealed** unit
  has no engageable target, so it's refused. That single rule *is* the stealth invariant now
  ("an attack in staging finds no one to hit"), and it does double duty: a scenario that stages
  **un-concealed** defenders (a keep assault) lets the very same attack land in pre-combat, no
  new code. The deploy row surfaces offensive skills only when a foe is actually engageable
  (`canEngage`), so default staging — which conceals the whole enemy roster — reads exactly as
  before (no attack buttons), making this byte-identical today. Two combat-only defaults remain,
  and they're **not** the engagement axis: **charged** (a CT-clock mechanic with no deploy
  equivalent) and **med-heal** (its herb-pick menu is combat-wired UX — a render-scope limit,
  trivially liftable by wiring a deploy herb-menu). Guarded: full suite (831, incl. a new
  keep-assault test — the same attack lands once the foe is un-concealed), e2e (46), sim
  (unchanged). The render *ghost* token (info-hiding stand-in for a concealed/intel-revealed
  foe) is the natural next layer on this flag — deferred until intel-reveal is on the table.
- **A `concealed` flag makes "no targets in pre-combat" true — the engagement substrate**
  (D67 W6, internal — byte-identical). Groundwork for treating engagement as *board state*
  rather than a per-skill phase rule. A new per-unit `concealed` flag means "not yet
  engageable": `enterDeploy` sets it on the enemy roster, `beginBattle` clears it for everyone
  (the encounter engages), and `isValidSkillTarget` won't return a concealed unit — so a
  combat action cast in staging finds *no one to attack* and sits idle, the way the player
  always imagined it (rather than being blocked by an explicit ban). Today this is redundant
  with the existing ban, hence byte-identical; it becomes load-bearing in W7 when that ban is
  removed. The flag is the seam for the futures the design wants: a **keep-assault** scenario
  stages standing defenders `concealed: false` (targetable in pre-combat), and **intel-reveal
  / ghost tokens** later clear or render it. Distinct from the D44 `hidden` ambush flag, which
  persists *into* combat until scouted/sprung. Guarded: full suite (830), e2e (46), sim
  (unchanged — the headless runs fight in the default combat phase, never concealed).
- **Deploy casts now cost a cooldown + show the impact pop** (D67 W5 — a deliberate
  *behavior* change, unlike W1–W4). Treating a deploy skill as just *an action* rather than a
  privileged "free" one: a skill cast in staging now **arms its cooldown** (one interpreter
  line — `commitSkill` runs in both phases; only combat also ends the turn / spends CT), so an
  ability used while setting up is genuinely used and cools toward combat. The cast also plays
  the same `flashHeal` impact pop combat does (the damage/heal float + combat-log already rode
  the bus since Increment 1). **What stays phase-specific is essential, not maintenance debt:**
  the **strike** FX (`flashHit` — a lunge + screen-shake + hit-stop) stays combat-only because
  it's a *strike telegraph*, and deployment shows no attacks (the stealth/alarm pillar); and
  the post-cast **continuation** stays forked — combat auto-ends into the enemy's AI turn and
  checks win/lose, while deployment waits for a deliberate *Advance Clock* to step the net and
  has no AI/win-lose (the enemies are frozen). Both are already behind one seam
  (`commitFieldAct`); merging the bodies would *add* `if (combat)` branches or delete the
  manual net-pacing, so they're left as the two genuine continuations. Guarded: full suite
  (829, incl. the repinned `deploy-skill-verb` cooldown split), the deploy→battle e2e (46),
  and sim (summary **unchanged** — the headless runs don't cast cooldown skills in staging).
- **One act-economy commit for the skill cast across both phases** (D67 W4, internal — no
  behavior change). The deploy cast (`castDeploySkill`) and the combat cast (`commitSkill`)
  each had their *own* "spend the Act + continue the turn" bookkeeping — `deployActed = true`
  + deploy-row refresh vs. `noteAct(...)` + `afterActionContinue`. Both now funnel through the
  **same** `commitFieldAct` seam that Search / Disarm already use, so the act-economy commit
  is *one* call across every field/skill Act in either phase (the seam gained a `charged`
  flag — a move-spend skill like Dash bills as a move, not the full Act). What stays branched
  is **genuinely phase-specific, not incidental**: combat plays the strike/heal FX (the
  engagement invariant — deploy never strikes) and continues via `afterActionContinue`
  (AI / win-lose), while deploy relights the reach and waits for a manual End Turn (the
  net steps then); and the cooldown commit is phase-aware (deploy doesn't arm). The
  combat-only Acts (attack / bribe / rescue) interleave their FX *between* lock and commit,
  so they keep their own shape — they're combat-only, not a deploy/combat divergence. This
  **closes the D67 unification**: the deploy and combat layers now share substrate (one clock,
  one skill/move verb, one RNG seed, one transition event, one act-economy seam), with only
  the FX, the capture-wave/AI continuation, and the phase-aware commit branching — by design.
  Guarded byte-identical: full suite (829), the deploy→battle e2e (46 — casts in both phases),
  and sim all green.
- **The front's net-closing turn is a bus event, not a hardcoded branch** (D67 W3, internal
  — no behavior change). The deploy loop used to special-case the front's turn inline (`else
  runFrontTurn()`); now, when the CT clock hands the **tempo source** its turn, the loop emits
  a `frontTurn` event and the **capture wave** resolves as a *listener* (`resolveFrontWave`).
  The front's turn is now a first-class **slot on the clock** — the same substrate every field
  entity already uses (D4) — so "as the net closes" effects can hook the moment without
  touching the loop. The capture *logic* (`resolveFrontTurn` → logged `capture` actions) and
  its RNG seam are unchanged, so replay still reconstructs catches from the log and never
  re-fires the event (it's live-phase only). Guarded byte-identical: golden trace (the
  tempo-turn order + capture outcomes), full suite (829), the deploy→battle e2e (46 — drives
  the real `frontTurn` dispatch), and sim all green.
- **Deployment runs on the Battle's *own* clock — one instance, not two** (D67 W2, internal
  — no behavior change). With the participant seam proven (W1), the separate deploy `CTClock`
  instance is **retired from the live game**: deployment now configures and runs on
  `battle.clock` — the *same object* combat ticks. `enterDeploy` narrows that clock to active
  players + attaches the front as the tempo source (`configureDeployClock`); the
  `beginBattle` boundary **sheds** that config (`resetForCombat`: detach the front, re-widen
  participation to every active unit, clear the staging timeline) so combat opens on a fresh
  clock and re-seeds initiative over the full roster. The reset is a **no-op** for a battle
  that never staged (replay, bare combat tests), so the combat path stays byte-identical. The
  scene's `deployClock` field is **gone** — there's one clock now, the phase chosen by its
  configuration. (`createDeployClock` survives as a *test-only* helper that builds a
  standalone deploy-configured clock; the tempo is now attached via `setTempo`, not a
  constructor arg.) Guarded byte-identical: golden trace, full suite (829), the deploy→battle
  e2e (46, the scene fold end-to-end), and sim all green; a new boundary test pins the
  combat re-widen — the enemy frozen in deploy fights again the moment the battle opens.
- **One clock *instance* can serve both phases — the participant seam** (D67 W-series,
  internal — no behavior change). The last thing keeping deployment on a *separate* `CTClock`
  was the roster: deploy built its clock over **players only**, combat over everyone. Now the
  clock carries a settable **participant predicate** (`setParticipants`) — who ticks toward CT
  and can be handed a turn — defaulting to `isActive` (alive + uncaptured), so a combat clock
  is byte-identical to before. `createDeployClock` builds over the **whole roster** (players
  *and* the pre-positioned enemies) and narrows the predicate to *active players*, so the
  enemies are **frozen off the same clock** — they neither charge nor ever take a turn — while
  the front rides it as the tempo source. This proves one clock element can stage *and* fight,
  the phase chosen by the predicate; the actual fold onto the Battle's own clock is the next
  step (deploy is still on its own instance here). `seedFlat` skips non-participants too, so
  the frozen enemies aren't deploy-seeded. Guarded byte-identical: golden trace, full suite,
  e2e (46), and sim all green; a new test pins the enemies frozen off a mixed-roster clock.
- **One skill verb across pre-combat + combat** (D67, internal — no behavior change). The
  deploy `deploySkill`/`deployMove` verbs are **retired**: repositioning and skill-casting
  now go through the **same** `moveUnit`/`useSkill` the combat turn uses, and the
  interpreter detects the Battle's new `phase` (`deploy` | `combat`) to decide the *commit*
  — in pre-combat it resolves the effect off the deploy clock with **no** CT/cooldown
  commit; in combat it commits per the skill's spend. The pre-combat → combat handoff is a
  single **logged** `beginBattle` boundary (built on the C3 event), so `replay()` delimits
  the deploy prelude explicitly rather than inferring it from verb kinds (`DEPLOY_KINDS`
  retired). Capstone: the engine now **enforces** the engagement invariant — a skill must
  declare the current phase in its `usableContext`, so an attack (or a charged ability)
  can't be cast in pre-combat at the *core*, not just hidden by the renderer's row gating.
  Seams: `Battle.phase`/`enterDeploy`/`beginBattle`, the phase-aware `skill` apply case. The
  scene's cast methods stay thin per-phase render wrappers around the one verb (they diverge
  only on flashes / the post-cast continuation). Guarded byte-identical: golden trace, sim,
  the deploy→battle e2e, and a new `phase-boundary` replay test all green.
- **Unification finish: one RNG seed + the last shared spines** (D67, internal — no
  behavior change). Two closing passes. (1) **RNG seam:** the scene reached into `run.seed`
  for its two deploy streams while the `Battle`'s own seed sat dormant; the run seed is now
  wired onto the `Battle` and deployment draws via a label-keyed `Battle.stream()` — one
  seed owner, byte-identical streams. (`Battle.roll` stays the separate drawCount-keyed seam
  for apply-driven combat draws; routing deploy rolls through it would desync replay, since
  they run outside the turn loop and their outcomes are logged or render-only.) (2) The last
  cleanly-shared **turn-loop spines** fold into helpers: `scanTrapsOnTurnOpen` (the on-open
  Awareness scan, both phases) and `armTargetedSkill` (the arm-a-skill-and-prompt tail). What
  *stays* phase-specific by design — the per-turn controllers (`deployNextActor`/`onAdvance`),
  the begin/end-turn bodies, and the skill *cast* (`castDeploySkill`/`commitSkill`) — diverges
  genuinely on the capture-wave vs. AI/win-lose, the two clock instances, and the drained
  `deploySkill` verb vs. the combat skill verb; forcing those into one branchy function would
  cost more than it saves. Guarded byte-identical (golden trace, sim, e2e).
- **One clock for deployment + combat** (D67, internal — no behavior change). Deployment
  ran on a bespoke `DeployClock` that re-implemented `CTClock`'s seed/tick/ready/next/spend
  beside it. That class is **retired**: `CTClock` gained an optional **tempo source** (a
  non-unit participant with a strict-lead-tie policy), and the enemy **front** now rides
  the one clock as that source — `createDeployClock(units, front)` builds a `CTClock` over
  the player units with the front folded in. Pre-combat and combat share the same clock
  element; the front still wins only on a strict CT lead (players take ties) and excludes
  captured units. The deploy→battle handoff is now a **single bus event** (`battleBegan`):
  the render reacts by lifting the D12 veil and tearing down the staging overlays, so
  "combat begins" is one announced moment other systems can hook, not a scattered set of
  imperative clears. Guarded byte-identical by the deploy golden trace; sim summary
  unchanged. (The two scene RNG streams are a separate, deferred follow-on — the clock fold
  doesn't need them, and replay reconstructs capture from the logged action.)
- **One shared scene path for deployment + combat** (D-feel, internal — no behavior
  change). With deployment now carrying combat's damage feedback and reach read, the
  parallel *render twins* that had drifted into two copies — **Search**, **Disarm**, the
  **click-ahead** replay, and the whole-turn **Undo** — collapsed into single
  context-parameterized helpers (`doSearch`/`doDisarm`/`processQueuedClick`/`undoTurn`
  take a `BoardCtx`), with a shared act-economy seam (`canFieldAct` / `commitFieldAct`) and
  the undo resync loop as the one spine. Only the genuinely phase-specific bits branch:
  the capture-wave row vs. the one-Act economy. Movement (`deployMove`/`playerMoveStep`)
  and the action row stayed separate here where they diverged by design — but their **shared
  spines** were extracted too: `pushTrapVerbs` (the Search/Disarm row block) and `readStepTraps`
  (the per-step trap-read + balk) serve both phases, leaving only the divergent verb/economy
  in each caller. Behavior-preserving — the full deploy→battle e2e is unchanged and green.
  (Movement has **since** folded into one weighted `moveStep` as well — see the top entry.)
- **Deployment lights the reach like combat** (D-feel). A deploy turn now steps
  tile-by-tile (`deployMoveBudget`), but the board showed **no reach read** — the player
  couldn't see how far a step might go. The deploy actor's reachable tiles now light (the
  amber **reach wash**) and a hover lights the **route** to a tile (the FE-style path
  read), reusing `CombatView.drawPreview` in a new `"deploy"` mode that **suppresses the
  strike telegraph and enemy intents** — engagement is combat-only (the stealth/alarm
  invariant), so the deploy preview never offers a strike. The wash is its own graphics
  layer over the green/red zone washes (under the markers); it relights as the budget
  spends down (step / undo) and clears between turns and at Start Battle. Pure render.
  Seams: `BattleScene.drawDeployReach` / `recomputeDeployReach`, `CombatView.drawPreview`
  `mode`. See [02-deployment](02-deployment.md).
- **Deployment surfaces damage feedback like combat** (D-feel). The combat FX bus
  (floating damage, the combat log, impact scaling, the heal/defeat readouts) was wired
  only at **Start Battle**, so a unit that sprang a concealed enemy trap **during
  deployment** took the HP hit **silently** — no floater, no log line. The listeners now
  attach once **up front** (`wireBattleFx`, at node start, on the per-encounter bus), so a
  deploy-phase trap spring floats `−N` and writes the log exactly as it would mid-battle.
  The bus persists across the phase boundary, so battle reads identically and nothing
  double-fires (the old `startBattle` block was removed; only the per-unit `turnStart`
  header stays combat-only — deployment has no per-unit turn cadence worth logging). Pure
  render; no core touch. Seam: `BattleScene.wireBattleFx`. Felt anywhere traps are afield
  in deployment (**L3** snares, **L6A**). See [02-deployment](02-deployment.md).
- **Micro-movement — responsive click-ahead stepping** (D-feel). The free-move turn
  already let a unit move tile-by-tile with the Act placeable anywhere (move → act →
  move), but a click landing during a step's ~150 ms walk animation was **dropped** (the
  board was `busy`), so rapid tile-by-tile clicking lost inputs. Now the latest plain
  board click made mid-step is **queued and replayed** the instant the step finishes, so
  consecutive stepping (and a destination click during a walk) flows without dropped
  clicks. Seam: `BattleScene.queuedTile` / `processQueuedClick` (replays through the
  shared `resolveBattleClick`). Armed/bribe targeting isn't queued (it needs a live aim).
  **Deployment now matches** (D-feel follow-up): a deploy turn was gated to *one*
  reposition (`deployMoved`); it now steps **tile-by-tile up to the unit's move range**
  (`deployMoveBudget`, decremented per step, shown as "Move left" on the focus card) with
  the same click-ahead (`processDeployQueuedClick`). Total range per turn is unchanged —
  the net still advances only between turns — so it's an interaction parity fix, not a
  reach/balance change.
- **Hover preview card — "before you commit" reads** (D-feel). A docked preview card
  (under the focus card) surfaces the outcome of whatever you point at, so a unit's
  free-move turn (move → act → move, one tile at a time) is legible: hover a **move tile**
  → step cost + **tiles left** + whether the Act is still up; hover an **enemy** → **Deal**
  + **Hits back** (the *auto-counter* the strike provokes — **0 today**, via the
  `retaliationDamage` seam a future riposte/thorns mechanic plugs into; not the foe's own
  next turn) + range; hover a **deploy tile** → its **capture risk** + zone band. Folds in
  the D64 armed-ability forecast (one card, repositioned under the focus card). Seam:
  `BattleScene.refreshPreviewCard`.
- **Deployment: capture-immune core + danger everywhere** (D-feel). The campfire's old
  "safe radius" blanketed small maps and was effectively **cosmetic** (capture was driven
  only by the enemy net; neutral ground was free). Replaced with the two-consequence zone
  model: a small **capture-immune protected core** (presence-sized, **capped to board
  width** so it can't dominate a small map — ~2 steps on the 8-wide demo boards, was ~6),
  surrounded by real danger — **neutral** open ground now carries a lower flat capture
  risk and the **net** is near-guaranteed. The net reaching the core **breaches** (combat
  starts, nobody taken); a unit caught out in the open is **captured**. Morale/intel now
  **trim the neutral rate** (the `exposureMultiplier`) instead of widening the immune core;
  the Scout's evasion and **Dig In** still cut the odds. Knobs: `SAFE_BASE_RADIUS`,
  `PROTECT_MAP_DIVISOR`, `NEUTRAL_DANGER`, `FRONT_DANGER`. See
  [02-deployment](02-deployment.md).
- **Enemy concealment in deployment** (PR #59, D12). Enemies are **pre-positioned but
  invisible** during deployment — the closing net and campfire safe-radius derive from
  real placement, but the foe's tokens (and nameplates/hover) are veiled until **Start
  Battle**, when they resolve into view. Seam: `CombatView.concealEnemies`. A future
  intel/scout ability can swap the hard veil for a faint **"ghost" formation**.
- **Traps as a both-phase hazard** (PR #58, D12). Concealed traps are live across
  **deployment and combat**. Detection reaches **full parity** across both phases:
  opening Awareness scan at the deploy line, a passive per-turn scan at each unit's
  turn-open, a per-step **sense-before-stepping** read (sense and stop short, or blunder
  in and spring it), plus **Search** and **Disarm** verbs during deployment. Tuning
  knob: `STEP_SPOT.bonus` (the per-step sense rate); `SPOT` constants left at defaults.
  Primarily felt at **L3** (and **L6A**, the inverted version).

---

## Open items / stubs

Known placeholders to resolve as the demo matures:

- **L6A access gate is stubbed.** "Inaccessible once the Medic is held" is the intent,
  but the proper party-state predicate is deferred — verify `securedWagon` actually
  gates on `flags["medic-freed"]` before relying on it.
- **`relic-hollow-blade` effect is TBD** — placeholder unique; design the effect with
  the user.
- **L7 finale is a stub** — replace once L6–10 are designed.
- **`4B → Den` is a skip-edge** (L4 → L6) — `validateExpedition` allows cross-layer
  edges, but it deviates from the strict layer-DAG note; flagged intentionally.
