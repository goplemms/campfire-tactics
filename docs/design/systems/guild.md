# System — The guild & caravans (the strategic logistics layer)

> Referenced by: [Design Overview](../README.md), [The overworld](overworld.md),
> [Logistics & inventory](logistics.md), [Stats](stats.md).
> Decisions: **D25** (three-tier stack & caravans), **D26** (run model & parallel
> adventures), **D27** (stakes/lords/endings), **D32** (secondary classes & leveling),
> **D33** (recruitment / three-tier roster), **D34** (treasury vs. run purse),
> **D35** (the two clean camp tiers), **D65** (job-growth framework; refines D33).

## Why this layer exists

M7's overworld borrowed *Slay the Spire*'s **shape** without its **engine**. In STS
the map matters because every fight feeds the deck and **HP is the currency you spend
to route**. Campfire has no deck — its equivalent of "the deck getting stronger" is
**roster + stores + gear**, i.e. **logistics**. So the run-frame is reframed as a
**campaign-scale logistics-planning problem**, and it needs a persistent **home** so
that "between adventures" and "between fights" stop both fighting for the word *camp*.

## The three-tier stack (D25)

A new persistent **guild** tier sits on top of the existing mission loop:

```
GUILD HALL    ← persistent home, BETWEEN adventures. Roster pool, armory,
   │            caravan assembly, several expeditions in flight.            (NEW)
   ▼
OVERWORLD     ← ONE caravan's adventure: the layered DAG (overworld.md),
   │            now scoped to a caravan. Drawn as a small mobile camp.
   ▼
CAMP / MISSION ← one node: Camp → Deployment → Battle → Resolution (D3).
```

- **Guild hall** — the persistent base. It **never hard-fails** (D27): there is always
  a cheap repeating sidequest to rebuild, so stakes come from permanent **loss**, not a
  fail screen.
- **Overworld** — unchanged in shape from D22–D24, but now **one caravan's** run rather
  than "the" run. The guild owns several.
- **Camp / Mission** — the D3 phase pipeline, untouched.

> **Two clean camp tiers (D35).** A later pass collapsed the old "three camps" muddle:
> the **overworld** tier is rendered as **one unified overworld camp** shown at *every*
> node (the pre-combat Meta phase folds into it — see [overworld.md](overworld.md)). So
> "home" now has exactly two meanings: the **guild hall** (between *adventures*) and the
> **overworld camp** (between *nodes*). Keep them visually distinct.

## Caravans (D25)

A **caravan** is the expedition unit — a **persistent, typed, upgradeable vessel** that
bundles:

- **Party slots** — who you bring.
- **Storage** — the [D14](logistics.md) shared-stack cap, now a *per-caravan* property.
- **Loaded supplies** — what was provisioned for this trip.
- **Locked equipment** — gear committed to this caravan, **unavailable to other
  caravans until it returns**.

You **own a stable** of caravans (need ≥2 to run multiple adventures at once), each
sitting on a tradeoff axis:

| Vessel | Capacity | Speed | Cost | Fits |
|---|---|---|---|---|
| **Scout cart** | low | fast | cheap | short sidequests, light squads |
| … | … | … | … | … |
| **Supply train** | high | slow | costly | deep main-quest hauls |

The Merchant raising storage (D14) becomes **"upgrade a caravan's capacity."** The
caravan also **doubles as the overworld camp** — the mobile campfire the overworld is
drawn as.

### Uniform slots (the tension knob)

**Slots are uniform — any character fits any slot.** Bringing a baker therefore
genuinely **costs a warrior**; caravan *size* is the only dial. Role-segmented slots
were rejected: they would make support picks "free" and kill the baker-vs-warrior
tension that justifies the non-combat jobs.

### Three on-theme scarcities

The layer manufactures three simultaneous pressures, all logistics-flavoured:

1. **Slots** — the baker-vs-warrior opportunity cost.
2. **The vessel** — which wagon's capacity you committed.
3. **Locked equipment** — your one good sword can't be in two caravans at once.

## Run model: one guild, two feeds, serial play (D26)

- **ONE shared persistent guild** — one roster, one armory, one progression.
  **Campaign** and **Endless** are two **content feeds** into it, not separate saves.
- **A quest board** makes the feeds concrete and is **never empty**:
  - **Main quest** — the campaign spine (arc + ending).
  - **Authored sidequests** — a finite, hand-made pool.
  - **Repeating generated sidequests** — the infinite "endless" tail.
  Parallelism is **asymmetric**: one main thrust + a renewable side stream (Darkest
  Dungeon / Three Houses shape), not symmetric juggling.
- **Commitment is parallel; play is serial (model C).** You commit people + gear across
  several caravans at once (the lock *is* the portfolio cost), but **play one caravan
  through at a time**; the guild clock advances between dispatches. **Auto-resolve is
  rejected** — it would dilute the hand-played tactical core. Dispatched-but-unplayed
  caravans simply **wait** (paused at their node).
- **Code shape:** a **`Guild` owns N run states**; today's single map + position
  (`run.ts`) becomes one of many. A clear path exists to later graduate toward an
  **interleaved global clock** (the rejected model A) without re-architecting.

## Money: the guild treasury vs. the run purse (D34)

Gold lives in **two pools** (the [economy](logistics.md#gold-as-the-routing-currency--the-economy-d28-d30)
spells out the loops):

- **Guild treasury** — the persistent **stock**. Funds **Upkeep** between runs, the
  armory, and caravan upgrades. It is a **pure vault** — fluff: the guild's **treasurer**
  simply holds it. **No passive faucet feeds it; its only inflow is earned quest
  payouts** — so the treasury cannot grow except by completing field work (*the field is
  the faucet, the guild is the buffer*).
- **Run purse** — a **flow** committed to one caravan; the tight, local routing currency
  spent in the field (travel, rest, field-buys, bribes). **Loot fills the purse.**

At **dispatch** the player **chooses how much treasury gold to load into the caravan's
purse** — a real risk dial. A **wipe loses the purse** (along with the people and locked
gear, D27); a returning caravan's **surviving purse flows back** to the treasury. The
purse is therefore a **fourth committed scarcity** alongside the three above (slots /
vessel / locked gear / **purse**), and it gives the theft vector (D30) extra teeth:
gold skimmed off the purse can be lost outright on a later wipe.

## Stakes: unkillable guild + Fire-Emblem lords (D27)

- **Two existing loss tiers** carry the weight: **mission loss** per node (D13/D21) and
  **caravan wipe** = lose that caravan's people (permadeath) + its locked gear, while
  the **guild survives** (Darkest Dungeon / Battle Brothers stakes).
- **EXCEPT 2–3 named campaign "lords"** (Fire-Emblem-style): a lord dying *during the
  campaign* is **game-over → reload last save** — which implies a **save system** for
  the campaign. An optional **hardcore/ironman** mode makes even that permanent. A lord
  riding a caravan that wipes = game-over, so **risking a lord on a deep node is a real
  gamble**.
- **Endings:** campaign-complete = clear the **main quest** (epilogue + unlocks that
  seed Endless); campaign-defeat = a **lord falls**; **Endless = depth/score, no
  terminal**, no lords.

## Recruitment: a three-tier roster (D33)

Party members come from **two sources** feeding **three tiers** (the BG3 split — generic
mercenaries + an authored cast):

| Tier | Source | Identity | Stakes |
|---|---|---|---|
| **Mercenaries** | gold-hired from a **refreshing pool** (guild hall + future recruiter nodes) | **randomized** (rolled stats/class) | fully **expendable** — the rebuild-after-wipe valve (D27) |
| **Companions** | **conversation, quests, mid-combat** — *not* gold | **authored**: named, fixed identity; starting class authored-but-flexible (D65) | permadeath, **earned not bought** |
| **Lords** | authored, campaign-critical | named, the **2–3** of D27 | death = **game-over** |

"Authored cast" is a **spectrum**: lords → other named companions → mercenaries. Authored
characters have a **fixed *identity*** — but an **authored-but-flexible class** (D65) — and
**level like anyone** (D32); mercenaries are the rolled ones.

- **"Guild conversation"** is the guild-hall form of the *interactable-camp* idea — you
  recruit some companions by talking to them at the hall (keep it visually distinct from
  the overworld camp, D35).
- **Mid-combat recruitment reuses existing machinery** (no new systems): a **bribed**
  (Noble INFLUENCE, [D30](overworld.md#the-gold-economy-faucets-sinks--theft-d30)) or
  **freed** (rescue, D21) **authored** character **joins the roster permanently** after
  the battle; a bribed **generic** enemy only **fights for the rest of the fight**
  (temporary, no roster bloat). The temp↔permanent flag is the whole new rule — the
  Noble's bribe and the rescue system **double as recruitment vectors**.

> **Deferred (D33).** The **authored-cast *data shape*** — how a companion declares its
> fixed identity and its recruit hooks (conversation / quest-reward / combat-defector) —
> depends deeply on mechanics not yet pinned, so it is intentionally left for later.

## Classes, secondary jobs & leveling (D32)

The guild is where character growth is managed.

- **FFT job model:** each character has one active **primary** class (defines
  stats/growth) plus a **slotted subset** of a **secondary** class's abilities,
  re-arranged at the guild. (Simultaneous dual-class was rejected as harder to balance;
  the FFT model is a weaker slot-saver but more controllable.) Secondary abilities tie
  into the same slot economy — versatility per slot.
- **Leveling:**
  - **Combat jobs** level via combat XP (as today).
  - **Secondary** abilities level through **use** (slower — the primary is mostly
    active).
  - **Non-combat jobs** level via a **passive trickle WHILE DEPLOYED on an adventure +
    a bump per successful ability use**. **Benched = no growth**, so sitting in the
    guild is never free training. ("Level the secondary by using it" and "the non-combat
    use-bonus" are the same mechanism.)

## Pseudo-example

> **At the guild hall.** The roster holds 11 people; the armory has one
> enchanted blade. The quest board shows the **main quest** (a deep, fortified
> 7-layer haul), two **authored sidequests**, and a stream of **generated** ones.
>
> The player assembles **two caravans**: the **supply train** (big, slow) for the main
> quest — loaded with the lord **Edrin**, two soldiers, the Cook, and the enchanted
> blade — and a **scout cart** (small, fast) for a generated sidequest with two cheap
> recruits. Committing both **locks** those people and that blade; neither is available
> to a third caravan.
>
> The player **plays the scout cart first** (serial play). It clears its sidequest,
> returns; the guild clock advances; its recruits gain a little XP, the non-combat
> hireling levels a notch from a successful use on the road.
>
> Then the **supply train** sets out on the main quest. Deep on layer 5 a fight goes
> badly and the caravan **wipes** — those soldiers and the enchanted blade are **lost
> for good**. But **Edrin is a lord**, so the wipe is **game-over → reload last save**.
> The player reloads and routes the supply train more cautiously, threading rest nodes,
> and finally clears the final node: **campaign-complete** — epilogue, and unlocks that
> seed the Endless feed.

## Open questions / future scope

- **Time model graduation** — model C → an interleaved global guild clock (model A): the
  fork that most reshapes existing code (`run.ts` → a `Guild` of N runs).
- **Recruitment** — *resolved in shape* (**D33**, three-tier roster above). The remaining
  open piece is the **authored-cast data shape** (a companion's fixed identity + recruit
  hooks), **deferred** as mechanics-dependent.
- **Caravan vessel roster** — the actual set of vessel types and their upgrade trees.
- **Save system** — required by the lord/ironman rule (D27); the overworld is currently
  in-memory + a re-enterable seed.
- **Guild-hall economy** — *partly resolved* (**D34**: the treasury-vault vs. run-purse
  split, dispatch-time purse allocation). Still open: the concrete shape of guild-level
  spending (recruiting prices, vessel upgrades, facilities) and the armory's locked-stock UI.
