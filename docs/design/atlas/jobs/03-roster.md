# 04c · The job roster (catalog)

The full built roster, grouped, with each job's **anchor** (the identity passive or presence),
its **actives / verbs**, the **surface** its value concentrates on, and **build status**. This is
a reference sheet — a snapshot of the data, not the source of truth. When it drifts from
[`jobs-data/`](../../../../src/core/jobs-data/), the code wins.

## Combat jobs — 2 active + 1 passive (identity anchor)

| Job | Anchor (passive) | Actives | Surface |
|---|---|---|---|
| **Soldier** | Brother-in-arms (+1 dmg per adjacent ally, cap 3) | Debilitating Strike · Turtle Formation | Combat |
| **Heavy Knight** | Tarpit (taxes proximity) | Cleave (90° arc) · Shove (push 1) | Combat |
| **Hunter** | Deadeye (ranged ramp) | Mark Prey (channel) · Reposition (kite) | Combat |
| **Medic** | Triage (heal harder the worse the wound) | Heal (herb + rider) · Mend (charged) | Combat + Camp |
| **Snare-Trapper** | — (enemy archetype / debuffer) | Snare (Immobilize ≤ 2 tiles) | Combat / Deployment |
| **Scout** | Quiet Footsteps (solo-flank + evasion) | Set Trap · Recon · Survey *(overworld)* | Deployment · Combat · Overworld |

## Non-combat jobs — 1 presence + 1–2 verbs

| Job | Anchor (presence) | Verbs | Surface |
|---|---|---|---|
| **Survivalist** | — | Set Trap *(deploy)* · Forage *(overworld)* | Deployment + Overworld |
| **Cook** | Field Kitchen (lowers Food upkeep) | Cook Stew (banks RP) · Feast (morale) | Camp / Overworld |
| **Merchant** | Appraisal (every market reads one tier better) | Find Trade · Savvy Barter *(+ Buy/Sell universal)* | Overworld / Camp |
| **Noble** | Renown (Influence per node-step) | Patronize *(camp)* · Bribe *(combat)* | Camp + Combat |
| **Banker** | *(presence anchor reserved)* | Invest the Purse · Borrow · Guard the Purse | Overworld / Camp |

## Prestige forks — a diff on the base kit

| Job | From | Anchor | Kit | Surface |
|---|---|---|---|---|
| **Assassin** | Scout | Subtle Blade (+8 vs full-HP) | Surgical Precision · Hidden Passage · *(keeps Recon)* | Combat |
| **Thief** | Scout | — *(cleared — anchor is economic)* | Hidden Passage · Deft Hands (skim) · Expert Lockpick (disarm) | Combat + Overworld |

## Universal verbs (every unit, no job needed)

**Move · Attack · Defend** (brace → Guarded) · **Dig In** (deployment hunker) · **Buy** at any real
market · a half-strength **Triage fallback** for Medic-less parties. Any class *can* deploy and
fight — a Banker just has only the universal verbs to use (permission is emergent, D38).

> Maps to: [`jobs-data/combat.ts`](../../../../src/core/jobs-data/combat.ts) ·
> [`scout-line.ts`](../../../../src/core/jobs-data/scout-line.ts) ·
> [`support.ts`](../../../../src/core/jobs-data/support.ts). Where each acts is the
> [`09 · Jobs × Phases`](../09-jobs-x-phases.md) matrix.
