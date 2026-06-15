# Example play session (annotated reference)

> A **living reference** of one full session, beat by beat, with each beat tagged by
> the system it exercises. Use it to **sanity-check changes**: when a system is
> revised, walk this trace and confirm it still hangs together (and tweak the beats
> to match). It is *illustrative*, not a spec — the specs are the other docs.
>
> **Legend:** ✅ = backed by a recorded decision · 🔶 = surfaced by this trace but
> **not yet fully designed** (an open question).

This session is the one we walked while pressure-testing the spine — ~30 beats, no
contradictions. Cast: **Knight**, **Mage**, **Rogue**, **Archer** (player) vs a
warband of **Fliers** (enemy).

## 1 · Camp / Pre-deployment

| Beat | Exercises |
|---|---|
| Start menu → a **campsite**-themed menu | Meta phase ✅ (D3) |
| Allocate gold; **default = pay all debts in full** | Upkeep, one gold figure ✅ (D15) |
| **Cut the repair budget** to buy **quality ingredients** → net *slightly positive* morale | Underfund a line; the **repair grace window** means no immediate gear/morale hit, while the meal lifts morale ✅ (D15/D8) |
| Speak to the **Seer** (a party member) → raise Intel | Intel lane 3 / Seer job ✅ (D10) · **recruitment** of the Seer 🔶 |
| Now know the **next three mission options** have **flying** enemies | **Intel pre-selection scope** (preview the option set) 🔶 (extends D10) · enemy **traits** (flying) 🔶 |
| Buy **net traps** to ground flyers | Provisioning consumables ✅ (D6/D14) · **trait↔counter** pattern 🔶 |
| **Choose one of several missions** | **Branching mission select** 🔶 |
| Allocate the Mage's **scribed spells** (editable until commit) | Vancian magic ✅ (D17) |

## 2 · Deployment ("earlier that day", on-map)

| Beat | Exercises |
|---|---|
| Place **grounding runes** | Runes = Vancian castings (reagent cost + deploy peril) ✅ (D4/D46/D17) |
| Arrange deployed members; ranging out to place | Deployment positioning ✅ (D7) |
| The **Mage ranges deep** past safe depth → a **noisy** placement spikes the camp-alert meter → **spotted**, bolts for cover, fails a capture roll partway home → **captured**, repositioned into the **enemy safe zone** | Spatial stealth-alert capture (noise-by-depth → spot roll → per-tile retreat roll) ✅ (D46), captured state ✅ (D7) |
| The **Rogue stays shallow / quiet** and makes it back | Same stealth model ✅ (D46) |
| **Begin combat** (no prep left); a beat to review comp with the Mage down (−1, off the initiative seed) | Phase transition; initiative seed ✅ (D7/D46) |

## 3 · Combat (the iso grid, CT clock)

| Beat | Exercises |
|---|---|
| **Rogue infiltration-deploys** mid-field, **hidden in fog**, near the captured Mage | **Class deploy ability** 🔶 · fog of war ✅ (D18) |
| **Archer** (highest initiative) fires at a flier **it has visual of**; an arrow is tracked | CT clock ✅ (D5) · vision-gated targeting ✅ (D18) · ammo ✅ (D20) |
| **Rogue Moves to the Mage, Acts to free her** | Move+Act ✅ (D5) · in-combat rescue ✅ (D9/D12) |
| Freed Mage's Speed only counts **from rescue** (didn't act earlier) | Freed unit cold-joins the clock ✅ (D5/D9) |
| **Flier E1 dives at the Rogue, misses** | accuracy/evasion (M3 stat block) ✅ |
| **Flier E2** steps on a **Grounding Rune** → **Grounded** (loses flight, −½ speed, ends move) | Entity trigger ✅ (D4) · trait↔counter 🔶 · status on Speed ✅ |
| **Flier E3 crossbolts the Mage for 4** | enemy ranged + damage ✅ |
| **Knight** crosses part-way toward the enemy | multi-turn movement ✅ (D5) |
| Freed **Mage casts a Whirlwind scroll**, **pushing Fliers 1 & 2 into net traps** → grounded, move 0 | Vancian scroll ✅ (D17) · **forced movement** ✅ (D19) · **push-into-entity combo** ✅ (D19/D16) |
| Several turns of exchange; **Fliers self-free** from the nets, regain flight | temporary-status escape/expiry ✅ (mirrors D12 snare) |
| Battle **won** | win/lose ✅ |

## 4 · Resolution

| Beat | Exercises |
|---|---|
| Result screen; units gain **XP** | **XP / leveling** 🔶 |
| **Net traps partially lost**; **Whirlwind scroll consumed**; grounding runes free; **partial arrows recovered** | Entity durability ✅ (D13) · consumable **recovery keywords** ✅ (D20) |
| **Gold** gained | economy ✅ (D6) |
| Special item: **cast-iron pan** (−2 silver cooking Upkeep) | **Relic/special item** 🔶 · plugs into one Upkeep line ✅ (validates D15) · **silver denomination** 🔶 |

## 5 · Back to the overworld

| Beat | Exercises |
|---|---|
| Overworld shows **X new quests**, some details **???** | **Run structure / branching select** 🔶 |
| Higher baseline **Intel** reveals some details — enemy **numbers**, **rewards**, a **potential new party member** | **Intel pre-selection scope** 🔶 (reveals comp + rewards + recruits) · recruitment 🔶 |

## What the trace covers (and what it flags)

**Validated as one motion:** intel → provision the counter → place it → it lands a
status (Grounded) → forced movement engineers a combo (push into nets); and the
capture→infiltrate→rescue arc across three separate systems (D7/D11 capture, class
deploy, D9/D12 rescue) with no special-casing. **Vancian magic** and **ammo** share
one kit shape (free basic + limited specials); **relics** plug into the single
**Upkeep** number — both payoffs of earlier simplifications.

**Still 🔶 open (tracked in `PROGRESS.md`):** intel pre-selection scope · branching
mission select + overworld↔camp · recruitment · class deploy abilities · enemy
traits↔counters · XP/leveling · relics/special items · silver denomination.

> **How to use this file:** when you change a system, find its beats above, confirm
> they still read sensibly, and edit them. If a 🔶 item gets designed, retag it ✅ and
> link its decision.
