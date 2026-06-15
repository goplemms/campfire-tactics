# Phase 2 — Deployment ("earlier that day", on-map)

> Pipeline position: `Pre-deployment → [DEPLOYMENT] → Combat → Resolution`
> Related systems: [Field entities & the trigger bus](systems/field-entities.md),
> [Stats](systems/stats.md), [Action economy](systems/action-economy.md)

## Description

Deployment is the **on-map "earlier that day"** phase: the party arrives at the
battlefield ahead of the enemy and sets up. This is **spatial logistics** — using
the materials provisioned in [Pre-deployment](01-pre-deployment.md) to place
**field entities** (traps, defensive nests, ritual runes — see
[field-entities](systems/field-entities.md)) against the real terrain.

It is **not** a free setup phase. It is a **per-unit push-your-luck gamble about how
far you range.** The enemy has a watchful camp; the deeper a unit ventures to prep,
the more noise it makes and the greater the chance it's spotted and run down.

### The exposure model — a spatial stealth gamble (D46, settles D11)

Deployment plays out **on the board, like combat**: you select a unit, walk it out
along the grid (A\*), and place entities where it stands. The gamble is **spatial**
and it stays **banded and shown on the board** (no hidden surprises) — the danger is
purely *how deep you commit a noisy action*, not how long you take.

- **Safe depth (silent).** Each unit has an Awareness-banded **safe depth** near your
  edge (drawn as a green zone). Acting *within* it — moving, placing — is **silent,
  zero-risk**. Range no further and you take no gamble at all.
- **Noise past safe depth.** A **noisy** action taken *beyond* the safe depth raises a
  **shared, party-wide camp-alert meter** by an amount scaling with how deep it was —
  the camp is growing suspicious, and every unit's overreach feeds the *same* meter.
- **The spot roll.** Right after a noisy action, a **spot roll** fires against the
  current meter (a higher meter ⇒ likelier spotted). Stay quiet and the meter
  gradually means nothing; push your luck repeatedly and the odds climb for the
  *whole party*.
- **Bolt for cover.** A spotted unit **runs for the nearest safe tile**, and **each
  tile of that retreat is its own capture roll**, with odds scaling by how deep it
  was caught — so a deep push is a long, dangerous walk home and a shallow slip
  usually makes it back. The per-tile chance is **capped** (even a deep retreat is
  never a sure loss), and the party's **last un-captured fighter is never netted**.
- **The meter settles.** A unit that survives a spotting **calms the meter back down**
  (the patrol checked and relaxed) — so one scare doesn't doom the rest of setup.

```
   CAMP ░░░░  safe depth   (silent — act freely, ~0%)
        ▒▒▒▒  shallow      (a little noise; if spotted, a short, likely-safe bolt home)
        ▓▓▓▓  deep         (loud; if spotted, a long retreat, each tile a capture roll)
   ENEMY████  the approach  (loudest; deepest, riskiest retreat)
```

Two stats drive the gamble (see [Stats](systems/stats.md)):

| Stat | Role in Deployment |
|---|---|
| **Awareness** | **Safety, two ways:** a **deeper safe depth** *and* a quieter footprint past it (less noise per tile / gentler capture odds). You move like you know the ground. |
| **Speed** | **Range & throughput.** How far you can venture *and still get home*, and how many placements you fit. (Also the unit's Combat CT stat.) |

High party **morale** widens the safe depth and lowers exposure (confident troops set
up bolder) — see [morale](systems/morale.md). And a **Tier-3 [intel](systems/intel.md)**
read (enemy *positions*) reveals where the danger bites hardest — so investing in
intel makes ranging out safer and smarter, a deliberate cross-reinforcement of the
prep systems.

A unit may instead **hold position**: stay within safe depth, take **zero risk**, and
be **ready** (well-positioned, full kit) when Combat starts. Deployment is therefore
opt-in per unit: *prep (range deep, more setup, more risk)* vs. *hold (stay safe, no
setup)*.

### Capture — the cost of overreach

If a tile of the bolt-for-cover retreat fails its capture roll, the unit is
**captured** (and is **repositioned into the enemy's safe zone** to start the
battle). A captured unit:

- still **appears on the battlefield**, but **bound/guarded** under enemy control;
- does **not** count toward your **active fielded count** (effective **−1**);
- is **removed from your side's initiative seed** (see below), so the enemy gets
  earlier turns;
- may be **out of position / underequipped** from whatever it half-finished.

Capture is **recoverable**: a captured unit is a **rescue sub-objective** on the
map. Reaching and freeing them mid-Combat turns the **−1 back into +1**. A unit
**still captured when the battle ends** is *not* instantly lost — it becomes a
**rescue follow-up quest** whose harshness scales with difficulty (see
[mortality-recovery](systems/mortality-recovery.md), D9). This keeps the gamble
dramatic without being a blind death roll, and only *abandoning* the rescue
ultimately loses the unit.

> **Scenario modifier — ambush in reverse.** A rescue mission is a *disadvantaged*
> battle: the enemy knows you're coming, so the rescuing party fights with
> **reduced Deployment**. This "reduced-Deployment" modifier is reusable for any
> encounter where you're the one caught out.

> Emergent payoff: your *own* greedy prep authors the battle's objectives. A
> captured ally is a fight you created by overreaching.

### Enemy prep — fortified encounters (D12)

Prep isn't only yours. **Fortified encounters** (an enemy camp, a defended
chokepoint, *every rescue mission*) have the enemy pre-place hazards too — while
open-field scraps and ambushes don't. This makes enemy prep a *flavor of encounter*
rather than a universal tax, and it gives your **Intel/Awareness** a defensive job:

- **Detection** of enemy entities is gated by [Intel](systems/intel.md) / Awareness
  (Tier-3 or high Awareness reveals them; otherwise hidden until sprung).
- **Disarm** costs an **Act** (the Survivalist's defensive side) — or just route
  around what you've spotted.
- The exemplar enemy entity is the **Snare**, which can drag a unit into **capture
  mid-battle** — see [field-entities](systems/field-entities.md).

### Initiative seeding (link to the CT clock)

Combat uses a per-unit [CT clock](systems/action-economy.md), but each **side**
gets a **starting CT seed** computed from its **deployed, non-captured** units'
Speed. Two consequences:

- Heavy, greedy prep that gets a unit captured **lowers your seed** → the enemy
  acts first. This is the **"prep vs. readiness"** dial in concrete form.
- A side that mostly **held position** starts the clock **warmer**.

### Output of the phase

Deployment hands Combat: the set of **placed field entities**, each unit's
**starting tile**, any **captured** units (and their guards), and the **initiative
seed** for both sides.

## Pseudo-example

> The canyon map from Pre-deployment loads. The party has `2 × trap kit`,
> `1 × fire-rune reagent`, and Vale's arrows already on her.
>
> 1. **Bram** (Survivalist, **high Awareness**) has a **deep safe depth**. He plants
>    **both trap kits** on the chokepoint tiles, all *within* that silent zone — no
>    noise, no spot roll. Both traps armed, **no risk taken**.
> 2. **Vale** (Scout, **high Speed**, modest Awareness) ranges **deep** past her safe
>    depth, near the enemy approach, to pre-place the **fire rune**. The placement is
>    **noisy** — it spikes the shared camp-alert meter, and the board warns her
>    capture risk is high. The player gambles for the value. The **spot roll hits**:
>    Vale **bolts for cover**, and **fails a capture roll partway home**. ✗ —
>    **captured**, repositioned into the **enemy's safe zone**.
>    - The side is now **3 active + 1 captured**.
>    - Vale's Speed is dropped from the **initiative seed** → the **enemy side
>      will act first**.
> 3. **Rook** (Soldier) and **Ember** (Mage) **hold position** — safe, ready,
>    well-placed behind the trap line.
> 4. **Commit.** Deployment resolves: 2 traps armed at the canyon mouth, 1 fire
>    rune live near the enemy approach, Vale captured on the ledge, enemy holds
>    the initiative. On to **Combat**.

## Open questions / future scope

- Exposure model is **resolved and shipped** (D46, settling D11): a **spatial stealth
  gamble** — silent **safe depth**, then noisy actions past it raise a **shared camp-
  alert meter**, an **immediate spot roll**, and on a spot a **bolt-for-cover retreat
  with a per-tile capture roll** (capped; last fighter protected; a survived spotting
  settles the meter). **No timed safe-period/buzzer phase** (the earlier D11 model is
  retired). Awareness = deeper, quieter safe depth; Speed = range + throughput. Only
  the noise/capture band %s, the alert cap, and safe-depth sizing are tuning.
- Enemy-prep symmetry is **resolved** (D12): A3 fortified-encounter type;
  Intel/Awareness-gated detection; Act-cost disarm or route-around; the Snare drags
  units into in-combat capture. See [field-entities](systems/field-entities.md).
- Guard composition for captured units (how hard a rescue is) is encounter-driven;
  generation rules come with the run loop (M6).
