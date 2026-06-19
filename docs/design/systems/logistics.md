# System — Logistics & inventory

> Referenced by: [Pre-deployment](../01-pre-deployment.md),
> [Deployment](../02-deployment.md), [Resolution](../04-resolution.md),
> [The overworld](overworld.md), [The guild & caravans](guild.md).
> Decisions: **D6**, **D14** (slotted storage), **D15** (Upkeep), **D28** (gold as the
> routing currency), **D30** (the gold economy), **D34** (two pools + Influence), **D47**
> (recovery as a gold spend), **D48** (the route forecast reads the burn). This is
> the game's **headline pillar**.

## Description

Most tactics games treat what you bring to a fight as an afterthought. Here it is
the **point**. Logistics is the connective tissue that makes the signature jobs
matter and gives the crunch player a deep optimization loop that spans the whole
run, not just the grid.

> **Design principle — wide logistics, micro at the unit.** Logistics lives at the
> **party/macro** level: broad, shared pools and provisioning decisions. The
> fine-grained, turn-to-turn micro-management lives at **unit control** (positioning,
> action economy, deployment placement, recovery triage). This split is *why*
> storage is one shared stash rather than per-unit bags, and it pre-answers many
> "shared vs. per-unit" forks.

### Two tiers of logistics

| Tier | Phase | Nature |
|---|---|---|
| **Resource logistics** | [Pre-deployment](../01-pre-deployment.md) (off-map) | What you *own and carry*: buy/sell, load ammo & materials, cook rations. |
| **Spatial logistics** | [Deployment](../02-deployment.md) (on-map) | Where you *commit* it: place materials as field entities against terrain, under a risk gamble. |

The link between them is the **provisioning constraint**: you cannot place in
Deployment what you did not carry from Pre-deployment, and you cannot carry more
than **storage** allows. Resource logistics gates spatial logistics gates Combat.

### Core nouns

- **Storage** — the master cap on everything carried: **one party-wide shared
  stash** of discrete **slots**, sized by the **Merchant** in clean bands (`+2
  slots`). Items pack by **slotted stacks (D14)**: each material defines a
  `stackSize` (arrows stack, e.g. 6/slot) and a `slotCost` (most items 1 slot; bulky
  ones like nest lumber may cost 2). Scarce by design; the central tension is *what
  competes for slots*.
- **Materials** — the build inputs for [field entities](field-entities.md):
  `trap kit`, `rune reagent`, nest lumber, etc. Each has **durability**: multi-use
  **charges** (a rope snare fires a few times) and whether its material **survives**
  use (recoverable) or is **consumed** (rune dust, gone). **Recovery (D13)** is
  outcome-gated and whole-field: **win** → reclaim every unsprung, intact, surviving
  entity — *including the enemy's* (salvage); **flee/lose** → nothing. See
  [Resolution](../04-resolution.md).
- **Consumables (special arrows · scrolls · reagents)** — one family (D17/D20):
  **storage-slotted, expended on use**, with a **per-item recovery keyword** — each
  defines its own **N% chance of recovery** on a win (a net arrow ~50%, a fire arrow
  0% "burned up"). The **Survivalist salvage perk** boosts the roll.
  - **Scrolls / reagents** power [Vancian magic](magic.md) (extra castings; rune
    builds).
  - **Special arrows** are the scarce, tactical ammo layer (fire, net/grounding, …).
- **Basic arrows are *infinite* (D20)** — the at-will floor and the archer-side twin
  of the mage's **default spell**, so a ranged unit is **never useless**. Only
  *special* arrows are a managed resource. (Archers and mages thus share one kit
  shape: a free basic + a limited pool of specials.)
- **Gold** — earned in Resolution (Merchant bonus), spent in Pre-deployment on
  provisioning **and Upkeep** (below).
- **Upkeep** — the party's per-night maintenance, expressed as **one gold figure**
  (see below). Food is part of Upkeep, *not* a carried item — so it never competes
  for storage slots.

### Upkeep — gold as the solvent for chores (D15)

Per the **gold-as-solvent** convention, *maintenance* (a chore) collapses into a
single **Upkeep** number on the camp menu, while *tactical* systems stay bespoke.
The dividing test: **interesting in-the-moment choice → its own system; necessary
chore → a gold cost.**

Upkeep is the **sum of per-job budget lines**; adding a maintenance job adds a line,
not a meter. You pay the total (the common case = one number), or **underfund a
line** when broke (the *choice* — what do I let slide?):

| Category | Owner | Grace | Breach → morale | Breach → mechanical |
|---|---|---|---|---|
| **Food** | Chef | 1 night | **High** | — (hunger is morale only) |
| **Repairs** | Blacksmith | ~3 nights | **Moderate** | **gear condition** drops: −defense, −crit |

- The **Chef** lowers the per-unit food cost (e.g. 2g → 1g); special **morale meals**
  are optional gold purchases that boost/guarantee morale.
- **Repairs replace per-item equipment durability:** one funded/unfunded state +
  grace, then blanket combat penalties — gear wear with no per-weapon meter. (Distinct
  from entity `durability`, D13.)
- Sustained **Low** [morale](morale.md), night over night, risks **desertion**.

### Gold as the routing currency & the economy (D28, D30)

Once the run is wrapped in [the overworld](overworld.md), logistics scales up from a
per-night chore to the **campaign-scale routing problem**. **Travel and rest are paid
in gold** (D28; D15 stands — no carried larder, no spoilage), so **gold is the
universal solvent**: travel, rest, provisioning, gear, bribes, and debt all draw one
pool. Caravan **storage still gates gear/ammo/consumables** (D14/D20) — just not food.
The map question becomes *"can I afford this route **and** a rest at the end?"*

#### Two pools: treasury (stock) vs. run purse (flow) (D34)

Gold is not one number. It lives in **two pools**, which is what makes the run *locally*
tight while the guild accumulates:

| Pool | Nature | Funds | Inflow |
|---|---|---|---|
| **Guild treasury** | persistent **stock** (a vault; fluff: a **treasurer** holds it) | Upkeep, armory, caravan upgrades | **earned quest payouts only** |
| **Run purse** | per-caravan **flow** committed at dispatch | travel, rest, field-buys, bribes | **loot** |

The player **chooses the purse size at dispatch** and a **wipe loses it** (D27) — so the
purse is a **fourth committed scarcity** ([guild.md](guild.md#money-the-guild-treasury-vs-the-run-purse-d34)).
Crucially, **no passive faucet feeds the treasury**: the **field is the faucet, the guild
is the buffer** — wealth comes from winning fights and completing quests, not from sitting
at home.

#### One verb per class, each a closed faucet↔sink loop (D30, D34)

Because gold must stay **scarce** or Upkeep stops biting, the economy classes each get
**one distinct verb** and every faucet is paired with a sink:

| Class | Verb | Tier | Loop |
|---|---|---|---|
| **Merchant** | **access + sell** | overworld | **access is scarce** — a tiered **node** property (`none < poor < basic < premium`); a Merchant *raises the floor* (impromptu market anywhere, worse rates). Gold income = favourable **sell** rates (goods → gold), **not** a money-printer (D61). Buys are the sink. |
| **Banker** | **time-shift + secure** | **overworld / purse-scoped** | interest on the **carried purse** (flat/diminishing faucet) ↔ buy-on-debt interest + **theft protection** (sinks/insurance). Fires **only in the field**; **does not touch the treasury**. |
| **Noble** | **influence** | overworld | political income → a separate **Influence** currency, accruing **passively per node-step** (D61, not a clickable verb) ↔ bribes / sway-avoid / access (Influence sinks). Influence **cannot pay Upkeep**, so it can never slacken the central pressure. |

> **Faucets of different inputs (D61).** The three classes stay competitive because each
> converts a *different* input: **goods** (Merchant sell) · **time** (Banker interest) ·
> **reputation** (Noble influence) — not three flavours of "gives gold."

**Influence** is a purpose-bound currency (= the Noble's whole economy), deliberately
**walled off from gold** — it retires a gold faucet rather than adding one.

#### Recovery is a spend; the forecast reads the burn (D47, D48)

On the overworld, **recovery itself becomes a gold spend** (D47). An **in-place rest** at any
finished node pays a night's Upkeep to bank Rest Points and heal a little — **repeatable**
until the purse taps out (each rest is a full node-step, so it also ticks ability cooldowns).
A **rest node** is the premium full heal that additionally **clears accumulated Upkeep debt**
(hunger / worn gear) in one swipe. So Upkeep is no longer just a per-night chore — it is the
**per-step burn rate** the route [forecast](overworld.md#the-route-forecast--overworld-fog-d48)
(D48) projects against.

That forecast's cost backbone is **deterministic**: `upkeep × steps + visible node fees`,
where *special* nodes may carry a **visible, known fee** (toll / town tax / gate fee) you can
see while planning and **route around** — distinct from the fogged thief skim. **Upkeep is the
travel cost** — there is no separate travel line. Fogged **loot** is the upside layered on
top, and the affordability **warning plans against the pessimistic loot floor** (so it never
falsely reassures), tightening as intel reveals more.

The **active theft vector** (D30) is the sink-side risk that gives the Banker teeth:
**thief/bandit event nodes** skim the **purse** on the overworld, and a
**gold/item-stealing enemy archetype** raids the [supply wagon](field-entities.md)
mid-battle. Recovery follows the D13/D21 control principle: **kill the thief → it drops
what it stole; a thief that escapes off-map keeps it** (a "chase the thief" tension, not a
flat loss). In-field buys spend the **purse**; the **guild armory** is separate locked
stock ([guild.md](guild.md)).

### The loop (why it's a pillar, not a chore)

```
Pre-deployment: pay Upkeep (one gold figure); spend gold + storage to provision
   Deployment:  commit materials spatially, gambling time/exposure
     Combat:    consume ammo, spring traps, detonate runes
   Resolution:  win → recover unsprung (incl. enemy salvage); earn gold; deduct spend
        ↺       re-provision smarter next time
```

Every arrow fired and every unsprung trap recovered is a number the optimizer can
chase. The Merchant's storage stat is the master dial that loosens the whole
system.

## Pseudo-example

> **Upkeep first.** The camp menu shows Upkeep **6g** (food `4g` after the Chef's
> discount + repairs `2g`). Gold is tight, so the player **underfunds repairs** this
> night — a moderate morale hit and gear condition starts to slide, but food stays
> covered (skipping *that* would gut morale immediately).
>
> **8 storage slots** (food isn't here — it's Upkeep; *basic* arrows aren't either —
> they're infinite). The player loads `2 × trap kit`, `18 × net arrow` (3 slots @6,
> special ammo), `1 × rune reagent`, `1 × nest lumber` (2, bulky) → **8/8 full**.
> They *wanted* a second rune but had no room — a direct cost of skipping the
> Merchant's storage upgrade.
>
> - **Deployment:** both trap kits placed; rune placed (Vale captured doing it).
> - **Combat:** Vale fires net arrows (then falls back to free basic shots); both
>   traps spring; the rune is detonated.
> - **Resolution:** party held the ground → the **intact nest** (and a salvaged
>   **enemy snare**) are **recovered**; spent consumables roll their **recovery
>   keyword** (a few net arrows come back); **+180 gold**.
>
> Next Pre-deployment, the player can finally afford repairs *and* the **+2 storage
> upgrade** — and now there's room for that second rune.

## Open questions / future scope

- Slot model is **resolved** (D14): party-wide shared stash of slotted stacks
  (`slotCost` + `stackSize`), Merchant sizes it in bands.
- **Ammo** (per-unit vs. shared pool + the "empty ranged feels bad" balance) is
  parked for a **dedicated follow-up** (the wide-logistics principle leans it toward
  a shared pool, but the balance question stays open).
- Whether materials degrade/spoil over a run (a logistics-pressure lever) is an
  attractive option — **Q8, up next.**
- First real implementation: the inventory/materials model is its own milestone
  (see the build plan), targeted around M5.
