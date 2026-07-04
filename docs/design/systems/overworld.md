# System — The overworld (seeded branching run map)

> Referenced by: [Design Overview](../README.md) (the loop), [Pre-deployment](../01-pre-deployment.md)
> (camp), [Intel](intel.md), [Mortality, recovery & difficulty](mortality-recovery.md),
> [The guild & caravans](guild.md).
> Decisions: **D22** (shape), **D23** (node kinds & camp), **D24** (intel preview),
> **D25–D27** (the guild/caravan layer that wraps this), **D28** (gold as the routing
> currency), **D29** (the overworld as a hook surface), **D30** (the gold economy),
> **D33** (recruitment vectors), **D34** (run purse), **D35** (the overworld action
> economy: camp at every node + cooldown spine + loose fatigue), **D45** (the economic
> ledger), **D46** (the node lifecycle — revised D80 into the night/day loop), **D47** (the
> two-tier recovery economy, revised D80), **D48** (the route forecast + overworld fog),
> **D80** (the night/day loop, **night-after-arrival**: **Camp** as react + prep beats,
> `Set Out` / `Begin`; effort → **Fatigue** recovery with the **Clearing**'s conditional big heal;
> the **early-events** arrival layer).

## Description

A **run** is no longer a straight line of fights — it is a **map** the player
**branches through**. The overworld is the screen between missions: it shows a
seeded graph of nodes, highlights the ones you can reach next, previews each with
banded intel, and lets you commit to a route. You advance node by node until you
**clear the final mission** (run complete) or **wipe** (run over).

This is the **run frame** — it does not change combat, camp, logistics, or
mortality; it only chooses *which encounter to play next*. The
[phase pipeline](../README.md) (Camp → Deployment → Battle → Resolution) runs
**inside** a combat node, exactly as before.

> **Scope note (D25–D27).** A later design pass wraps this overworld in a persistent
> **guild** tier: the overworld is now **one caravan's** adventure, and the guild owns
> several. The shape, determinism, and node loop below are unchanged — what changes is
> the *ownership* (`run.ts` → a `Guild` of N run states) and the *meaning* of a
> terminal (a wipe loses a **caravan**, not the guild). See
> [the guild & caravans](guild.md). The rest of this doc describes a single caravan's
> run.

### Shape — a layered node DAG (D22)

The map is a **Slay-the-Spire-style layered DAG**: columns ("layers") of nodes
with **forward-only** edges from one layer to the next.

```
  layer:  0        1        2        3        4   …   N
          start ─┬─ n1-0 ─┬─ n2-0 ─── n3-0 ─┬─ …  ─── final
                 │        ╲        ╱        │
                 └─ n1-1 ──┴─ n2-1 ─────────┘
```

- **Layer 0** is a single **start** node — your opening camp. It is the entry
  position; you never *fight* it, you choose forward from it.
- **Interior layers** are `minWidth..width` nodes wide (default **2..3**).
- **The final layer** is a single node — the run's last mission. Clearing it is
  **run-complete**.

The whole map is **seed-derived** — generated from `streamFor(seed, "map")` — so
**replaying a seed reproduces the same layout, the same node kinds, and the same
edges**, and therefore the same set of choices. Each node's *contents* are equally
deterministic (below), so a replayed run with the same choices is identical.

#### Connectivity invariants

The generator guarantees a **legible, never-stuck** graph:

- Every **non-final** node has **≥1 outgoing** edge → no dead ends.
- Every **non-start** node has **≥1 incoming** edge → no orphan nodes.
- Therefore **every node is reachable from the start**, and from any node you can
  always walk forward to the final layer.

On top of those spanning edges, a bounded extra **fan-out** adds real branch
choices (a node may lead to more than one node in the next layer; two nodes may
re-merge on a shared successor).

### Node kinds (D23)

M7 keeps the menagerie minimal — **two kinds**, both data, no special-casing in
the loop:

| Kind | What happens |
|---|---|
| **combat** | A fight. Reuses `generation.ts` for the encounter and runs the full **Camp → Deployment → Battle → Resolution** flow. Difficulty scales with **map depth** (the node's layer is the encounter index). |
| **rest** | **No fight** — the **Clearing** encounter (D80 naming). A recovery day: **every unit Deep Rests** (Fatigue wiped, debt cleared), **plus a big heal for any unit at Tier 0** when the rest resolves; a small [morale](morale.md) uptick. **(D47, revised D80:** the free nightly **chip** heal is the lesser tier, at *every* node. See [Deep Rest's conditional big heal](#deep-rests-conditional-big-heal-d80).) |

> **Updated by D35.** The Meta phase no longer lives on a separate screen: the overworld
> is rendered as **one unified camp surface shown at every node** (below). The old
> "Camp = Meta phase before a combat node" becomes *"the camp actions you take at a
> **combat** node before committing to the fight"* (pay upkeep, bank RP, tick dying
> clocks, provision, read intel); a **rest** node is simply the node themed on recovery.
> One surface, one clock — see [The overworld action economy](#the-overworld-action-economy-d35).

A combat node's encounter is derived as:

```
nodeEncounter(seed, node) = generateEncounter(streamFor(seed, "node:" + node.id), node.layer)
```

— the **layer is the difficulty index**, so deeper missions ramp up, and the
per-node `streamFor` label keeps each node's content reproducible regardless of
what the player chooses or how many other draws the run makes.

### Choosing a node — the banded intel preview (D24)

A branch is only a *choice* if it is **informed**. Before committing, each
reachable node shows a **preview** (`previewNode`), wired to the
[intel](intel.md) system:

- The node's **kind** is always shown, and for a combat node its **encounter
  type** (open-field / fortified) — you always know the *shape* of what you're
  walking into.
- The party's **intel floor** (D10) reveals more about a combat node, banded
  identically: **Tier 1** enemy **types** → **Tier 2** the **count** → **Tier 3**
  positions (and starting vision). A **reward hint** is banded the same way
  (hidden → coarse gold band → approximate → exact).
- **Rest** nodes preview a recovery hint instead.

Previews are a **pure projection** of the seed-built map and the deterministic
per-node encounter, so the **same seed surfaces the same reachable previews** — no
live RNG, fully replayable.

### Run terminals

- **Wipe** — no combat-capable roster unit remains (`isRunOver`, unchanged). The
  run ends; the run-end screen shows the **seed** for replay.
- **Run complete** — a **final-layer** node is cleared. A new terminal the
  overworld surfaces, distinct from a wipe.

## Gold is the routing currency (D28)

The overworld is an **economic routing problem**, not a difficulty menu. **Travel and
rest are paid in gold** (D15 stands — no carried larder, no food spoilage); food stays
a gold [Upkeep](logistics.md) line. So **gold is the universal solvent** — travel, rest,
provisioning, gear, bribes, and debt all draw one pool, and the question at every branch
is *"can I afford this route **and** a rest at the end of it?"* Caravan **storage still
gates gear / ammo / consumables** (D14/D20); it just no longer gates food. Because one
pool funds everything, the **faucet ↔ sink balance** (below) is what keeps the map
meaningful — a slack economy trivializes routing.

## The overworld as a hook surface (D29)

The overworld is a **second hook surface** — the twin of the combat tier (D3/D4) — with
**its own action economy** denominated in **node-steps / cooldowns**, alongside the
combat CT clock (D5). An **overworld ability** is **data declaring a phase + a cost**,
drawn from a deliberately short limiter menu (D15 restraint):

- **Fatigue** (a **per-character** meter — one per unit, not a shared party pool; see
  [stats](stats.md)) — spent by slow personal clearing verbs and **restored by nights / rest**
  (D73). The forager *can* work every node, but not without tiring.
- **Vancian charges** *(not yet built)* — the intended magic-pool lever for spell-shaped
  overworld effects (scry, forage). **No `charge` cost knob or magic system exists in code today**
  — `OverworldCost` carries cooldown / per-node cap / fatigue / gold / influence / rp only. Treat
  this as future scope until a magic system lands; the fatigue-priced **Forage** (D73) is the
  near-term version, not the Vancian one.
- **Node-refresh / gold cost / step-cooldown** — for whatever else fits.

## The overworld action economy (D35)

D29 named the *menu*; D35 assembles it into a working economy — the genuine **twin of the
combat CT clock** (D5), one tier up.

- **Surface — camp at every node.** Arriving at *any* node opens **one unified overworld
  camp** (the "interactable camp," the literal title callback): take overworld actions,
  then choose the next edge. This **collapses three surfaces into one** — the map screen,
  the interactable-camp idea, and the pre-combat **Meta phase** (D3/D23) — leaving **two
  clean camp tiers** (the [guild hall](guild.md) between *adventures*; this overworld camp
  between *nodes*). A **combat** node adds a "commit → Deployment + Battle" exit; a **rest**
  node is themed on recovery.
- **Tick — the node-step.** The caravan advances node→node *together*; one step is one
  tick of the overworld clock. Cooldowns and the fatigue curve are measured in node-steps.
- **Spine — per-ability cooldowns.** Each overworld ability carries its own **node-step
  cooldown** (market, scout, scry, …), so every ability is **non-trivial to time even with
  the specialist** — a Merchant can't market every node; the decision is *when* to spend
  the charge. **Why cooldowns:** they *encourage* engagement (use-it-or-waste-it), whereas
  a tight hoardable pool *punishes* use (players hoard, the choice curdles into agony).
  - **The spine generalises to two axes (D61): pacing × price.** The cooldown is the
    *pacing* half; the full model gives **every** camp/overworld action two independent
    knobs — **pacing** (`cooldown` *or* a per-node use cap *or* none) and a per-cast
    **price** (fatigue / gold / Vancian charge / RP / Influence) — with the invariant that
    **no action may be both unpaced *and* unpriced** (that loophole is what let the costless
    job meta-skills — Cook's stew, Merchant's trade — fire unlimited times for free). A
    resource-paid action (a Vancian cast) leaves *pacing* off and is bounded by its price —
    so it can **fire as many times per node as the party can afford**. (Interim: a
    `usesPerNode` cap on the costless jobs ships ahead of the full model.)
- **Guardrail — fatigue, the clearing currency (redesigned D73).**
  [Fatigue](stats.md#fatigue-overworld-meter-d29) is **not** a tight rationed pool and **not**
  the spine — it is the one **per-character** cost, reserved for slow gold-free **clearing
  verbs** (Forage, Train, Triage). It keeps the D35 shallow-floor shape (invisible in normal
  play) but each band now bites: **Worn** is the safe allowance (wiped by any night); **Weary**
  makes that unit's rest-heal **cost more RP** and **carries `level − floor` fatigue to the next
  day** (only a clearing/rest node clears the carryover); **Exhausted** adds a **combat tempo
  debuff** (the unit fields **Slowed**). The bite is **consequence-based, not a lock** —
  recoverable and outplayable, cleared in full only by routing to a clearing (rest's second job).
  Revises D29: fatigue now **does** reach combat, but **only at Exhausted and only as tempo**
  (never a flat power debuff). See [stats](stats.md#fatigue-overworld-meter-d29) for the band table.
- **Per-ability costs.** **Vancian charges** ([magic](magic.md)) and **purse gold** (D34)
  ride on top as costs *specific* abilities name — not the global pace.

## The node lifecycle — the night/day loop (D46, revised D80)

> **Revised D80** (design session, two passes). The first pass unified the old *Make Camp → End
> the Night → Survey → Break Camp* into a night/day loop. The second set **night-after-arrival**:
> you travel *wounded* and make camp on **arrival**, so the road stays dangerous and reaching the
> next rest is the relief the economy is built on. The camp is **two beats** bracketing the
> journey — a post-encounter *plan* beat and an on-arrival *prep* beat — earned because you scout
> ahead (Survey) **before** you commit your route.

Every node still runs **one contract** — the camp (D35), the ledger (D45) and the forecast (D48)
attach to the same seam. **One node = one node-step.**

```
[ENCOUNTER]
  → REACT-CAMP   · plan: scout ahead (Survey), bank loot, read the forecast   (no rest)
  → choose your next node   =   "Set Out"
  → THE ROAD (the day)   · an early event may fire — you travel WOUNDED
  → PREP-CAMP (on arrival)   · the night's REST (chip / Deep Rest) + gear up
  → "Begin"   →   [ENCOUNTER]   → …
```

1. **React camp** — *post-encounter*, at the node you cleared: read the **forecast**, **scout
   ahead** (Survey — this is *why* it's a distinct beat: you scout before you route), bank loot.
   **No rest here.** Exit by **choosing your next node** — that choice *is* "Set Out."
2. **The Road** (the day) — travel to the chosen node; an **early event** (D80) may fire. You travel
   **wounded** — recovery waits for arrival.
3. **Prep camp** — *on arrival*: the **night's rest** lands here (the chip, D47; or a Clearing's
   Deep Rest), then you **gear up** for this node's encounter (heal, buy at a Town, set traps).
   Exit: **Begin.**
4. **The Encounter** — **named by kind**: **Battle** / **Town** / **Event**. (A **Clearing** is the
   special case — its "encounter" *is* the arrival Deep Rest, so its prep camp and encounter merge:
   no separate beat.)

**Why two camps, not the interruption tax.** They do **different jobs**: the react camp is
*direction* (where do I go — scout, then pick); the prep camp is *readiness* (get set for the node
I chose). Node-selection between them gives each a distinct purpose, and Survey **must** happen
before the route is picked — so the split earns its keep rather than duplicating a hub.

**Where the rest sits (night-after-arrival).** The nightly heal + Fatigue step-down (D47) lands at
the **prep camp**, on arrival — so you journey wounded and recover at the destination. *(This
retimes the shipped B1 chip from post-encounter to arrival.)*

**Terminology (D80).** **Camp** (the beat, seen twice — react + prep), **Set Out** (choose route →
travel), **Begin** (prep → encounter). Retired: *Make Camp / End the Night / Survey* (the beat) */
Break Camp* — and the interim single **"Rest & Set Out"** (shipped in code, #94) now **splits** into
*Set Out* + *Begin*. Author labels against the
[**glossary**](../glossary.md#lifecycle--the-node-spine-d46-revised-d80).

**Where rest fits (rationale, unchanged).** The *"rest or push on"* choice lives on the **map
(routing to a Clearing)**, never a free camp toggle; the nightly heal is only a **chip** (D47), so
real recovery still costs a route — *dodge-every-fight* stays dead, now sharpened by wounded travel.

## Early events — the arrival layer (D80)

A node's **day** can carry a light event on the way in, *before* the main encounter —
decoupling "event" from node-kind (any node may host one). **Occasional, never every node**
(the D16/D35 anti-agony stance), in two classes:

- **Random events** — a shared, reusable, node-agnostic pool (found a satchel of gold, a
  pickpocket skims some, a passing merchant offers a trade). Texture; cheap to author. Partly
  built already — the *thief*, *patron*, and *Merchant access* are exactly these.
- **Tailored events** — authored onto a *specific* node, high-impact, tied to its encounter.
  Rare and special. This is where the **scouting payoff** lives: scouting a node ahead can
  preview (and let you prepare for, or route around) its tailored event.

**The encounter-bypass rule.** A tailored event that lets you *skip* the main encounter (e.g.
negotiate passage) must be **gated** — pay gold and/or meet an **Influence** floor — **and
forgo the encounter's loot**. You keep the **EXP** and your **HP**, but not the plunder. Never
strictly better than fighting; a *situational* call that ties back to the recovery economy
(bypass a fight you can't afford to take). A bypass **short-circuits** the encounter — the day
resolves at the early event and the loop returns to **Camp** with no encounter that day.

## The economic ledger (D45)

The overworld is an **economic routing problem** (D28), but the budget that *is* the decision
was invisible. The **ledger** is the readout — a **pure projection** of run state (the
`previewNode` pattern), **purse-scoped** (the treasury is the guild hall's concern; Influence
is shown but **never summed into gold**, D34).

- **Broad totals → expand for crunch.** Default = a few category totals (Upkeep / Loot /
  Field spend / Banker / balance); expand a category to its line items (the Upkeep bill's
  Food/Repairs, individual loot/spend events).
- **Two roles across the camps (D46/D80):** the ledger **forecasts** the route ahead at the
  **react camp** (where you plan and pick your next node) and **reconciles** the night's spend at
  the **prep camp** (what this stop costs).
- **Jump to market** when usable (town/rest node · Merchant present · off cooldown) — size a
  buy against the budget before committing.
- **A soft, intent-aware gate** on **Set Out**: always one glance away, the bottom-line delta
  shown inline, **hard-stopping only when warranted** (a projected shortfall, can't-afford-
  the-rest, outstanding debt, an underfunded line) — never a per-night chore (the D35/D16
  anti-agony stance).
- **Voluntary underfunding — the ledger as an *input* (extends D15).** Untick a line you
  *could* afford to free its gold for a riskier play (skip Food's morale hit to buy a buff
  that nets the day positive). The gate keys off **intent** — it won't nag a deliberate skip,
  only a can't-afford one. **Food** = a recoverable morale gamble; **Repairs** = a compounding
  gear-condition debt (surfaced distinctly). Tuned so the skip keeps real teeth, else the D15
  Upkeep sink slackens.

## The two-tier recovery economy (D47, revised D80)

> **Revised D80.** Recovery, unified under one meter. A unit's cycle goes to **an effort skill**
> (*everything* is one — Survey, Train, Cook… — effort from **heavy** down to **negligible ~0**) or
> to **Rest**. Effort accrues **Fatigue** (banded tiers); rest sheds it. A **Clearing** offers a
> special **Deep Rest**. There is **no assignment board and no "arduous" category** — it's one
> number, *effort*, in and out.

**Effort → Fatigue (the one meter).** Every skill and item interaction carries an **effort** cost
(a generalized `OverworldCost.fatigue`), from a heavy skill (Survey ≈ 4) to a **negligible** one
(~0). Effort accrues **Fatigue** in **narrowing banded tiers** — each tier's band tightens, so
stacking heavy skills without a rest tips you further, faster:

| Tier | Band (illustrative) | width |
|---|---|---|
| 0 — fresh | 0–4 | 4 |
| 1 — Weary | 4–7 | 3 |
| 2 — … | 7–9 | 2 |
| … | narrowing | … |

Fatigue bites in combat at the deep end (the D73 Weary/Exhausted consequences); its main job is
gating recovery (below). *(Numbers illustrative — the **structure** is canon, the values tune in
playtest.)*

**Two rests shed it:**

| Rest | Where | What it does |
|---|---|---|
| **Nightly rest — the chip** | **every** node — free & automatic (shipped, `RECOVERY.nightlyChipHp`) | A **small** HP heal + steps Fatigue **down to the floor of the tier below** (one tier per night). One heavy skill (→ Tier 1) is wiped by a single night; only **stacking** (→ Tier 2+) lingers. The heal is a free *floor* — small enough that real recovery still means routing to a Clearing (*dodge-every-fight* stays dead). |
| **Deep Rest — the Clearing** | a **Clearing** node *provides* it (D23) | **Every unit Deep Rests** — Fatigue wiped to 0, accumulated debt cleared — **plus a big heal, but only for a unit at Tier 0 when the rest resolves.** No assignment, no opt-out. |

### Deep Rest's conditional big heal (D80)

The big heal is gated on **Tier 0 at rest-time** — one check that folds in both *how worn you
arrived* and *what you did here*:
- **Arrived Weary** (recent effort not yet rested off) → not Tier 0 → wipe only, no big heal.
- **Spent heavy effort at the Clearing** (Trained here) → pushed out of Tier 0 → no big heal. This
  is what stops a fresh unit **training *and* banking the heal** in one stop.
- **Did nothing, or only a light (~0-effort) action** → still Tier 0 → **big heal.** Light actions
  coexist with a full rest for free — the whole point of negligible effort.

The **allocation puzzle** falls out of unit state, no board: you want your *hurt* units to reach a
Clearing **at Tier 0** so they cash the big heal — so you spend effort on the *healthy* ones (whose
heal would be wasted) and time heavy skills away from the rest. "Rest the hurt, work the healthy,"
expressed entirely through Fatigue.

**Surfacing it (D80).** Fatigue is a decision driver now, so it reads **per unit**: a tier on the
**party dossier** and the **camp roster readout**, plus — when you **hover a unit's ability** (Party
tab) — the **projected Fatigue delta** ("→ Weary") *before* you spend it, riding the existing
action-preview system. **Survey** lives in the **react camp's Intel drawer** (a row per reachable
node); a surveyed node **tightens on the map** and carries a **scouted** marker so read/unread nodes
are legible at a glance. *(Projecting a unit's Fatigue onto the route forecast — "will it be Tier 0
when it reaches the Clearing?" — is a later playtest-gated add.)*

**Action readouts — the cost-component grammar (D80 UI pass).** Camp action rows read as
**cost-bearing cards** in the state-tile language: three aligned lanes — the **verb**, the acting
**unit**, and the **cost components**. Cost is a standardized, D&D-style component line — **gold ·
fatigue · material · cooldown** — each type an `icon N` chip in a fixed, **left-aligned column**, so
the icons line up down the rows and you can scan a column ("which actions cost fatigue?"). Hover
still drives the richer projected-delta EFFECT PREVIEW. *(Future: an **expandable detail drawer** per
card — a segmented **fatigue bar** (Rested·Worn·Weary·Exhausted bands) showing the unit's current
fill + the projected "→ Weary" delta, and a **material breakdown** naming the items an ability
consumes. The data exists — `FATIGUE_TIER_FLOORS`/`fatigueTierIndex`, `spendFatigue`, the material
cost — it's a visualization, gated on having a real material-costing ability to design against.)*

**Parked (open, D80):**
- **The effort-skill roster** — **Survey** is the first real one (≈4 effort, cooldown 1, Scout-only,
  L2). **Prestige** (exists, D65) and a net-new **Train** are the next, designed separately.
- **Paid in-place rest** — with a free nightly floor now existing, what a *paid* rest buys is under
  review (the caps note below is the pre-D80 tier).
- **Numbers** — tier bands/widths, per-skill effort, the big-heal size — a tuning pass; the
  structure is canon, the values are not.

**Two caps by design:** **gold** (can you afford another rations night?) and the per-night
**RP rate** (one night banks only so much → healing is rate-limited regardless of wealth →
the rest node stays faster/better). **Heal floors at ≥1** on a wounded party (a paid rest
never reads "healed 0" like a bug); it **refuses when already full** (no empty drain). The
whole tier lives or dies on **gold scarcity** (D30/D34) — an accepted balance burden.

## The route forecast & overworld fog (D48)

The ledger's forecast — *"this route + a rest at the end → purse at the bottom"* — is governed
by one fact: **cost is knowable, income is fogged.** Upkeep is exact; loot is only ever seen
**banded by intel tier** (D10/D24). Four pillars:

- **Reach = overworld fog scaled by intel.** Intel governs whether you see the route *at
  all*: visibility = `baseReach + tier × bandStep` steps forward, **base ≈ half the map** (a
  deep-planning tool, not an early wall), tunable to effectively infinite. The
  **immediately-reachable nodes are always visible** (never stuck — the map-invariant spirit);
  a **pure visibility mask** (a BFS cut at the reach limit, determinism intact). This is the
  **reach** axis — the second intel axis alongside **depth** (see [intel](intel.md), D48).
  *Consequence (intended): the nearest-rest / runway is intel-gated too — seeing the third
  rest ahead is what intel buys.*
- **Burn = upkeep + visible node fees.** Upkeep **is** the travel cost (no separate universal
  travel line — D28 satisfied without a new mechanic). On top, *special* nodes carry a
  **visible, known fee** (toll / town tax / gate fee), modelled as an event-node kind
  (reusing the M11 registry) — "a thief that tells you the price up front." Fees are **known
  in advance** (within reach) and **avoidable by routing**. The deterministic cost backbone =
  `upkeep × steps + visible fees on the path`.
- **Loot = fogged range**, never revealed beyond the player's intel tier (no fog-leak); rest
  nodes earn nothing (cost-only), events skim/cost.
- **Warning = against the floor; show the range; intel clears warnings.** The soft gate
  evaluates on the **pessimistic** (low-band) loot — it **never reassures on gold you might
  not get** (false confidence is the one failure mode); the panel still shows the full range.
  A tighter intel band **raises the known floor**, so **scouting a node can clear its
  warning** — intel *relaxes* warnings, not just reveals (the asymmetric-floor ethos,
  D8/D11/D35).

**Horizon:** one committed step (banded loot) + the runway to the nearest *visible* rest — not
a whole-map projection (deep nodes are fog, branches combinatorial; the decision served is
"which edge next"). The seam is a pure `projectForecast(run)` over the **visible** set,
reusing `computeUpkeep` + `rewardHint` + the visibility BFS — the `previewNode` pattern one
tier up.

## The gold economy: faucets, sinks & theft (D30)

Each economy class earns its caravan slot with **one distinct verb** so they are not
three flavours of "gives gold":

- **Merchant = ACCESS** — markets in the field (basic anywhere via the fatigue-gated
  town-trip, premium at town nodes, better prices everywhere). In-field buys use **run
  gold** (a flow), distinct from the **guild armory** (locked stock).
- **Banker = TIME-SHIFT + SECURE** — buy-on-debt (auto-repaid from future run gold),
  *financial* interest, and **theft protection**. **Purse-scoped (D34):** the Banker's
  whole kit fires **only in the field**, on the **run purse**, and never touches the guild
  treasury.
- **Noble = INFLUENCE** — bribe enemies to turncoat / sway-avoid fights (leans on the
  D24 preview) **+ *political* income**. **Refined by D34:** that income is a separate
  **Influence** currency (patronage/reputation) spent *only* on the Noble's verbs — it
  **cannot pay Upkeep**, so it is the Noble's whole economy rather than a redundant gold
  faucet.

> **Reworked by D61.** Two corrections to the above. **(1) Merchant = ACCESS, *not* a gold
> faucet.** The Merchant's signature action is *access to trade*, which is itself **scarce** —
> the caravan can't find a market at every node (terrain, distance). Access is modelled as a
> tiered **node property** (`none < poor < basic < premium`); a Merchant in the party **raises
> the floor** (an impromptu market anywhere, at worse rates — the same floor-raising idiom as
> the Noble's intel floor). Their *gold income* comes from favourable **sell** rates
> (goods → gold), never from minting — the old `+50g` `Trade`/`Market` money-printer is
> retired. **(2) Noble political income is *passive*, not a clickable verb** — it accrues at
> the node-step like the Banker's interest, killing the unlimited-faucet exploit. The three
> classes stay competitive as faucets of **different inputs**: goods (Merchant) · time
> (Banker) · reputation (Noble).

> **Pool & currency structure (D34).** Gold is **two pools** — a persistent guild
> **treasury** (a vault whose only inflow is quest payouts) and a per-caravan **run purse**
> (the field-spent flow, filled by loot, chosen at dispatch, lost on a wipe). Plus the
> Noble's **Influence**. See [logistics.md](logistics.md#two-pools-treasury-stock-vs-run-purse-flow-d34).

**An active theft vector** is the sink-side partner that gives the Banker teeth:
**thief/bandit event nodes** skim the **purse** on the overworld, and a **gold/item-
stealing enemy archetype** does so mid-battle (it targets the
[supply wagon](field-entities.md), D31). A thief you **kill drops what it stole**; one that
**escapes off-map keeps it** (the D13/D21 control principle). Every faucet is paired with a
sink so gold stays scarce and **Upkeep keeps mattering** (D15).

> **Doubles as recruitment (D33).** The Noble's **bribe-to-turncoat** and the rescue of a
> captured enemy are also the **mid-combat recruitment** vectors: a bribed/freed **authored**
> character **joins the roster permanently** after the battle, while a bribed **generic**
> enemy only fights for the rest of the fight. See [guild.md](guild.md#recruitment-a-three-tier-roster-d33).

## Pseudo-example

> A fresh run loads from seed `emberfall`. The overworld draws **7 layers**. The
> party stands at the **start** camp (layer 0).
>
> 1. **Layer 1 offers two nodes.** `previewNode` shows the top one is a
>    **fortified combat** node; the party's Tier-1 intel floor reveals *goblins +
>    a brute*, reward hint "modest". The bottom node is a **rest**. The player is
>    nearly full HP, so they take the **fight**.
> 2. **Combat node.** The usual Camp → Deployment → Battle → Resolution runs; they
>    win, bank gold, recover an unsprung trap kit, and return to the **map**.
> 3. **Layer 2 branches three ways.** A Tier-2 read (the Seer divined) now shows
>    **counts**: one node is *five wargs* (rich reward), another *two goblins*
>    (modest), the third a **rest**. Hurt from the last fight, the player takes the
>    **rest** node — a quiet night: upkeep paid, +RP, the wounded auto-triaged,
>    morale ticks up. No battle.
> 4. **They press deeper.** Each layer the encounters ramp (layer = difficulty), so
>    by layer 5 the warbands are bigger than the squad can safely clear. The player
>    threads rest nodes between fights to stay alive…
> 5. **…and reaches the final node.** Clearing it ends the run **complete**. (Had
>    the squad wiped first, the run-end screen would show the **seed** to replay the
>    exact same map and choices.)

## Open questions / future scope (the **next** batch, out of M7 scope)

- **Route endings — *resolved* (D27).** The *meaning* M7 deferred is now decided: a
  wipe loses a **caravan**, not the guild; a **campaign-complete** = clearing the main
  quest (epilogue + unlocks that seed Endless); **campaign-defeat** = a **lord** falls;
  **Endless** has no terminal (depth/score). The remaining open piece is the concrete
  **reward/unlock content** of each ending. See [the guild & caravans](guild.md).
- **More node kinds** — partly specced now: **town** nodes (Merchant premium markets,
  D30), **thief/bandit event** nodes (the theft vector, D30), and **recruiter** nodes (the
  mercenary pool, D33) are decided in shape. The **recruitment model** itself is resolved
  (D33, three-tier roster); only the **authored-cast data shape** is deferred. General
  **event** nodes with choices remain to be designed (see [guild.md](guild.md)).
- **The parallel-adventures time model (D26).** Today `run.ts` holds exactly one map +
  position; "multiple at once" needs a **`Guild` of N run states** (model C: serial
  play, parallel commitment), with a path to an interleaved global clock later.
- **Map shape tuning:** layer count / width / fan-out / rest frequency as a
  difficulty or biome dial; elite/boss nodes and their tuning.
- **Pathing texture:** one-way shortcuts, locked nodes, intel that reveals deeper
  layers than the immediate next one.
- **Persistence:** on-disk save slots — now **required** by the lord/ironman rule
  (D27), not just nice-to-have (M7 is in-memory + the re-enterable seed).
