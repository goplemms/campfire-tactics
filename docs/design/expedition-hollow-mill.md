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

Recruits join via **authored post-win grants** (not the starting bundle):

- **Pip the Cook** — rescued at **L1**; opens the camp economy (Cook Stew / RP).
- **Sela the Medic** — freed at **L4B** *or* the **L6 Secured Wagon**; opens sustain.
- **Mira the Merchant** — recruited at the **L5 Market**; opens markets.

**Starting bundle:** purse 120 · supplies `salve×2, stimulant×1, antidote×2` ·
storage cap 8 · morale 2 · difficulty normal.

---

## Per-node goals

Each node carries one **teaching beat** — the mechanic it exists to introduce or test.

### L0 — Provisioning camp (`start`, rest)
**Goal:** the pre-deployment logistics surface before a single blow. Spend the opening
purse, load supplies. No combat.

### L1 — Skirmish at the Mill Yard (`e1`, combat)
**Goal:** the first fight *and* the first rescue, taught as one shape.
- **Teaches:** the CT clock (C1) + flank/isolation (C2).
- **Design:** winnable raw by the no-healer trio. Main cluster is two bodies (Thug,
  Bowman); the **cutthroat captor sits apart in a corner** — the flank affordance and
  the Pip-rescue affordance are the *same corner*, so isolating to gang up *is* the
  rescue.
- **Reward:** 60g, 1 salve, 100 XP — XP tuned so every survivor's primary job reaches
  **L2 (the 2nd-active unlock)** right after this fight.
- **Grant:** Pip the Cook joins on the win (front-loads the camp economy).

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
  and the action row stay separate where they diverge by design, but their **shared spines**
  are now extracted too: `pushTrapVerbs` (the Search/Disarm row block) and `readStepTraps`
  (the per-step trap-read + balk) serve both phases, leaving only the divergent verb/economy
  in each caller. Behavior-preserving — the full deploy→battle e2e is unchanged and green.
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
