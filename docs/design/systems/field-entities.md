# System — Field entities & the trigger bus

> Referenced by: [Deployment](../02-deployment.md), [Combat](../03-combat.md),
> [Resolution](../04-resolution.md). Decisions: **D4**, **D31** (the supply wagon).

> **Build status.** **Built:** the trigger bus + entity **registry**, player **traps**,
> **concealed enemy trap-fields**, and trap **spot / disarm / salvage** (incl. the D82
> snare sweep). **Designed, not built (deferred, #148):** defensive **nests**, ritual
> **runes** (part of Vancian magic, D17), the **snare capture-countdown** (snares
> Immobilize + damage only today), the **D31 supply wagon**, and the **D16 entity-combo
> chaining** (provisional). Each of those sections below carries a marker.

## Description

Traps, defensive nests, and ritual runes look like three features but are **one
abstraction** (decision D4):

> A **field entity** is a non-unit thing that occupies the map, is **placed during
> [Deployment](../02-deployment.md)**, carries state, and **reacts to battle
> events via a trigger policy**.

Unifying them this way is what keeps the signature prep mechanics cheap to extend:
adding a new placeable is adding **data**, not a new system.

### Anatomy of a field entity

| Field | Meaning |
|---|---|
| `position` | tile(s) it occupies |
| `owner` | which side placed it |
| `state` | armed / sprung / charging / intact, plus charges remaining |
| `trigger` | the **policy** that decides when its effect runs (below) |
| `effect` | what happens when it fires (damage, aura, terrain change…) |
| `durability` | multi-use **charges** (rope snare fires a few times) and whether the material **survives** use (recoverable) or is **consumed** (rune dust) |
| `provenance` | the material it was built from (for recovery in Resolution, **D13**) |

### Trigger policies (the three faces)

- **One-shot on condition** → **Trap.** *(Built.)* Listens for `unitEnterTile`; fires
  once (damage / status), then is spent.
- **Passive aura** → **Defensive nest.** *(**Designed, not built** — no aura entity
  exists, #148.)* No event needed; while a unit holds the tile it grants cover / range /
  elevation. Really a **terrain modifier**.
- **Pre-paid charge** → **Ritual rune.** *(**Designed, not built** — part of the deferred
  Vancian magic family, D17/#148.)* A [charged ability](action-economy.md) whose charge was
  paid in Deployment. Runes are **Vancian castings** ([D17](magic.md)) — paid in **reagent
  cost** and subject to the **deployment peril**, freely placeable within those limits.
  - **Auto:** resolves when a condition is met (enemy enters AoE).
  - **Manual:** a unit spends its **Act** to detonate now.

### Enemy-owned entities & counterplay (D12)

The `owner` field means entities can belong to the **enemy** too. In **fortified
encounters** (an enemy camp, a defended chokepoint, *any rescue mission* — see
[Deployment](../02-deployment.md)), the enemy pre-places hazards just like you do.
This gives **Intel** and **Awareness** a *defensive* job, not only an offensive one:

- **Detection** — gated by [Intel](intel.md) / Awareness. A **Tier-3** read or high
  Awareness **reveals** enemy entities up front; otherwise they're **hidden until
  sprung** (you find them the hard way).
- **Disarm / avoid** — once seen, a unit may spend an **Act** to **disarm** (the
  Survivalist's defensive mirror of trapping), or simply **route around** it.

**Exemplar enemy entity — the Snare.** *(Built: the snare triggers on enter-tile and
applies **Immobilized** + damage. **Designed, not built:** the **capture countdown**
below — deferred, D12/#148; the per-unit counter shape is reserved but unused,
`status.ts`.)* The designed snare would apply **Immobilized** for X turns *plus* a
**capture countdown** (banded) that abstracts *enemy reinforcements reaching that spot* —
ticking on its own, no specific captor modeled. Free the unit (ally **Act** to cut loose,
or destroy the snare) before it expires, or they are **captured** — the *same* captured
state as a Deployment overreach (rescuable sub-objective, [D9](mortality-recovery.md)
policy). This makes **capture a unified mechanic with two entry points**: pre-battle
overreach and in-combat helplessness.

> Implementation note: the built snare already carries **status effects** (Immobilized);
> the **per-unit capture meter** (ticked on `turnStart`) is the reserved, still-unbuilt half.

### The supply wagon — a defendable asset (D31)

> **Designed, not built (D31/#148).** No supply-wagon entity, defend-the-wagon objective,
> or wagon-seeking thief archetype exists in code — the theft vector today is the
> overworld thief/event-node skim (D30). The section below is design intent.

The caravan's supplies appear on the battlefield as a **field entity**: a
**supply wagon** (the [overworld camp](overworld.md) made physical) with `position`
and `state`, deployed at the **back edge**. It is not a trap or rune — it is an
**objective object** that can be **attacked and defended**, and it is the in-combat
target of the **theft archetype** (D30): a gold/item-stealing enemy that ignores your
front line and makes a run at the wagon.

This turns "protect your investment" into a concrete **defend-the-wagon** beat rather
than a vague escort. The non-combat **support units** that fielded with the caravan
(see [the guild & caravans](guild.md)) deploy **near the wagon** as its bodyguards:

- They are **low enemy-targeting priority by default** — enemy AI **deprioritizes**
  both the support units and the wagon **except the thief archetype**, which actively
  seeks the supplies. That single exception *is* the bodyguard gameplay (and the reason
  it doesn't degrade into a constant babysit).
- Support units have **positional abilities** — strong in their home zone, weak if
  dragged out (e.g. the **Cook by the campfire** deals bonus damage with a hot pan),
  which both rewards smart positioning and naturally keeps them back where they're safe.

> Implementation note: the wagon reuses the entity `owner`/`state` plumbing; "thief
> seeks the wagon" is an **AI target-priority rule**, and "deprioritize non-combat
> units + wagon" is its default. Loss of the wagon is a **logistics** consequence
> (stolen gold/items), resolved like other Resolution tallies.

### The trigger bus (the architectural hook)

Combat is built around an **event/trigger bus** (`event-bus.ts`). The loop announces
moments and **listeners react**. The event names carry **no `on` prefix** (that was
doc-only drift); the real set has also grown well past the original four:

- `turnStart` / `turnEnd`
- `unitEnterTile` / `unitLeaveTile`
- `unitDamaged` / `unitHealed` / `unitDefeated`
- `chargeResolved` / `chargeFizzled`
- `unitRescued` / `unitSwayed` / `unitEscaped` / `orderChanged` / `trapSprung` /
  `battleBegan` / `frontTurn` (the newer events, `event-bus.ts:20-72`)

Field entities are just listeners — and the bus is **wired and load-bearing today**:
the entity **registry**, player traps, concealed enemy trap-fields, and Cook buffs
applied at battle start all ride it. (The original "M3 builds this before any entity
exists / today the bus may have zero or one listener" note is stale — that insurance
paid off and the bus is fully in use.)

### Chaining — entity combos (D16, provisional)

> **Designed, not built (D16/#148).** Entity-combo chaining is provisional design — no
> chain-scheduling exists in code today. Intent below.

Entities don't *merge*; they **chain through the bus**. When one fires, it inspects
its **own tile and 4-adjacent neighbors** (matching the grid's 4-connectivity) for
entities to set off — and **schedules the reaction onto the [CT clock](action-economy.md)
with a `speed`**. This reuses the charged-ability machinery wholesale:

- `speed = instant` → the chained effect fires immediately.
- `speed < instant` → it becomes a **timer** that resolves later on the timeline —
  *counterplayable*, exactly like a slow charged spell (it can be disrupted before it
  lands).

So a trap can **instantly** chain a snare, or kick off a **delayed** ritual that
erupts a few ticks later — combos with real timing texture, and **zero new systems**
(just a listener that schedules a CT event). This is the lowest-confidence design
call so far; expect to **revisit it** once the bus and clock are real code.

**Forced entry also fires entities (D19).** A unit **pushed/pulled** onto an entity's
tile triggers it via the same `unitEnterTile` event — so shoving an enemy into a
trap/net/snare is the unit-driven version of chaining.

### Lifecycle across phases

```
Deployment: build entity from a provisioned material, place it, register listeners
   Combat:   bus events fire effects; state advances (armed → sprung / detonated)
 Resolution: on a WIN, unsprung+surviving entities (yours AND the enemy's) recovered
```

## Pseudo-example

> *(Illustrative — the **Trap** beat is live; the **Nest**, **Rune**, and the Snare's
> **capture-countdown** beats depict the designed-not-built entities above, #148.)*
>
> **Trap (one-shot on condition).** Bram builds a `trap kit` into a field entity on
> the canyon-mouth tile: `trigger = unitEnterTile (enemy)`, `effect = 20 dmg`,
> `state = armed`. In Combat the enemy Vanguard enters that tile → the bus emits
> `unitEnterTile` → the trap's listener matches → 20 dmg, `state = sprung`.
>
> **Nest (passive aura).** A Builder raises a nest on a ledge: `trigger = passive`,
> `effect = +2 range, +1 defense while occupied`. No event — when Vale stands on
> it, the aura applies; when she leaves, it lapses. Intact at battle's end → it can
> be recovered.
>
> **Rune (pre-paid charge, manual).** Ember's `fire-rune reagent` becomes an entity
> near the enemy approach: `trigger = manual`, `effect = AoE fire`,
> `state = charging`. It sits idle until, in Combat, freed-Vale spends her **Act**
> to detonate it on the clustered enemies — the charge collapses to zero and fires
> immediately.
>
> **Snare (enemy-owned, in-combat capture).** In a fortified fight, an
> enemy snare sits on a path tile, **undetected** because the party skipped Tier-3
> intel. Rook steps on it → `Immobilized (3)` + a 3-tick **capture countdown**
> starts. Bram spends his next **Act** to cut Rook loose on tick 2 — one turn later
> and Rook would have been **captured**, turning the fight into a rescue.

## Open questions / future scope

- Entity combos are **designed but not built** (D16, provisional, #148): no merging —
  they would **chain** via the bus, scheduling reactions onto the CT clock with a
  `speed` (instant→timer). Flagged for revisit if/when implemented.
- The **bus + registry** and the first data-defined entity (the trap) **shipped**
  (M3–M5); the still-unbuilt placeables are the nest, rune, supply wagon, and the snare
  capture-countdown (see the build-status banner up top).
