# Phase 1 — Pre-deployment (Meta / world menu)

> Pipeline position: `[PRE-DEPLOYMENT] → Deployment → Combat → Resolution`
> Related systems: [Logistics & inventory](systems/logistics.md),
> [Stats](systems/stats.md)

## Description

Pre-deployment is the **off-map, interstitial space** — a world/camp menu, *not*
the battlefield. It is where the game's **resource logistics** live. Nothing here
touches the grid; instead, the player decides *what they will be able to do later*
by spending gold, storage, and time on provisioning.

This phase is the **constraint layer**. Everything you can do in Deployment and
Combat is gated by what you provisioned here. It is also where the non-combat jobs
that don't act on the map do their work:

- **Merchant** — **trade goods for gold** at a market (buy supplies in, sell
  salvage out), and — as a Merchant in the party — **raise a node's market access**
  so otherwise market-less stops can trade (D61). Storage, the master cap on
  everything carried, is set by the **caravan/vessel** — *not* the Merchant (D61
  retired the old gold-mint and storage-stat).
- **Cook** — owns the **Food** line of [Upkeep](systems/logistics.md) (lowers the
  per-unit cost), and provides **morale** (see [morale](systems/morale.md)) via meals
  and a banked between-battle **heal/buff**. Food is paid as Upkeep gold, *not*
  carried as a storage item.
- **Quartermaster role (any unit)** — **load the loadout**: distribute ammo, trap
  kits, and rune reagents into limited storage slots.
- **Seer** — **gather [intel](systems/intel.md)** on the coming fight, reading a
  divination reagent (or, at master rank, freely) to lift the provisioning fog. The
  exemplar intel job (the intel counterpart to the Survivalist's traps).
- **Mages** — **allocate scribed spells** (see [magic](systems/magic.md)): distribute
  each mage's daily castings across their known spells, re-allocatable up until the
  deployment commit.

### Camp: Upkeep

Each night the camp menu shows **Upkeep** — one **gold figure** covering party
maintenance (Food via the Cook, Repairs via a Blacksmith, …), per the
**gold-as-solvent** convention (D15). Pay it in full (the chore), or **underfund a
line** when broke (the *choice*): skipping **food** is a fast, **high** morale hit;
letting **repairs** slide is a slower, **moderate** hit that also drops **gear
condition** (−defense, −crit). See [logistics](systems/logistics.md).

### Camp: recovery & revival

Between battles (each **night**), the camp is also where units heal and the gravely
wounded are saved — both detailed in
[mortality-recovery](systems/mortality-recovery.md):

- **Recovery** — support roles (Cook, Medic, Bard, …) bank **Rest Points** that the
  player spends by **triage** to heal chosen units. Scarce, so someone often rides
  into the next fight hurt.
- **Cleric (Hard mode)** — paying a local cleric is **emergency life-saving** for a
  *dying* unit; it costs gold, a deliberate **economy sink** alongside the Merchant.

The output of this phase is a **locked loadout**: the concrete set of consumables
and equipment the party carries into Deployment. Once you commit and head to the
map, you cannot return to the shop — you fight with what you brought.

Key tensions a crunch player optimizes here:

- **Storage is scarce.** Arrows compete with trap kits compete with rations. The
  Merchant's storage stat is the dial that loosens this.
- **Provisioning is blind-ish.** You commit *before* (or with only partial intel
  of) the battlefield, so you're betting on what you'll need. **[Intel](systems/intel.md)**
  lifts that fog in banded tiers (types → numbers → positions) via three lanes:
  the **Intelligence** stat (free floor), **scouting** (gold/risk), and the **Seer**
  (divination).
- **Spend now vs. bank.** Gold spent on consumables is gold not saved for a key
  piece of equipment later in the run.

## Pseudo-example

> The party returns to camp after a fight with **240 gold** and **8 storage
> slots**. The next encounter is rumored to be a narrow canyon (partial intel
> from Bram's Awareness).
>
> 1. **Merchant.** The player sells salvaged scrap (+60g → 300g) and considers a
>    storage upgrade (+2 slots for 150g) but holds off — too expensive this early.
> 2. **Upkeep.** The camp shows Upkeep **6g** (Food `4g` after the Cook's discount,
>    Repairs `2g`). The player pays it in full this night → no morale or gear hit.
>    (300g → 294g.)
> 3. **Loadout.** With 8 slots and a canyon ahead, the player loads:
>    - `2 × trap kit` (2 slots) — chokepoints love traps,
>    - `18 × net arrow` (3 slots @6) — special ammo to ground the fliers,
>    - `1 × fire-rune reagent` (1 slot),
>    - `1 × nest lumber` (2 slots, bulky).
>    Storage is now **full (8/8)**. The player *wanted* a second rune but has no
>    room — a direct consequence of not buying the storage upgrade.
> 4. **Cook.** Buys a **hearty stew** morale meal (gold): party morale +1 and a
>    banked **squad heal** (small HP restore at the start of next battle).
> 5. **Commit.** The player locks the loadout and advances to **Deployment**. The
>    canyon map loads; the shop is now closed for this encounter.

## Open questions / future scope

- Morale's mechanical effect is **resolved** — see [morale](systems/morale.md)
  (D8); only its exact effect magnitudes remain as tuning.
- Equipment depth (weapon types, slots, upgrades) is deferred — this phase
  establishes the *logistics frame*, not a full RPG inventory yet.
- Intel is **resolved** — three lanes (Intelligence floor / scouting / Seer),
  banded tiers; see [intel](systems/intel.md) (D10). Only thresholds/costs are
  tuning.
