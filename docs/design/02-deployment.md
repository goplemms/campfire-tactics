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

It is **not** a free setup phase. It is a **push-your-luck race against a closing
net.** The enemy is advancing; the longer your units linger forward preparing, the
likelier one is caught out of position.

> **Note (D63).** The model below is the **implemented** one — *the closing net*. It
> replaces the earlier "safe period → auto-retreat at the buzzer → per-step capture
> roll" gamble specced in **D11** (which was never built). The banded, transparent,
> spatial *spirit* of D11 — and the Awareness/Speed/morale/intel roles, and the
> capture/rescue payoff — all carry over; only the resolution curve changed.

### The closing-net model — two influence sources on one clock (D63)

Deployment runs as a **turn-based phase on the same board and the same CT clock as
Combat** (see [action-economy](systems/action-economy.md)). Player units take real
turns — **move**, **Dig In**, or **place** a field entity — and the board is shaped
by **two radial influence sources**, measured in orthogonal steps:

- **Your campfire** — a home-edge anchor projecting a small **protected core** where
  units are **capture-immune**. Its radius scales with the party's total combat
  **presence** (a sturdier party holds more ground) but is **capped to the board's
  width** (`PROTECT_MAP_DIVISOR`), so the core stays a tight pocket on a small map and
  only opens up on larger ground — it never blankets the field.
- **The enemy's danger source** — a single actor on the deployment clock that starts
  with no reach and **grows one step on each of its turns**. The danger **overrides**
  the campfire: when the net reaches a unit sitting in your protected core it **can't
  grab them** (the core is immune) — the contact just **trips the alarm and starts the
  battle, nobody taken** (a *breach*, the soft consequence).

> **There is no free ground.** Outside the protected core the whole board is a danger
> zone — **neutral** open ground carries a real (if lower) capture risk, and the
> **net** is near-guaranteed. Safety is something the campfire *carves out*, not the
> board's default.

```
   CAMP ★▓▓░░  Safe core   (campfire-protected — capture-IMMUNE; net contact only breaches)
        ░░░░░  Neutral     (open ground — a real, lower capture risk: NO free ground)
        ▒▒▒▒▒  Warning     (the ring the net takes next turn)
   ENEMY█████★ The net     (near-guaranteed capture for anyone but an infiltrator)
```

**Capture is rolled only on the net's turn** — never per player turn — for every
**unprotected** unit (neutral *or* netted), **deepest first**; the protected core is
exempt. The net's rate is **near-guaranteed** (`FRONT_DANGER`); neutral ground is a
lower flat rate (`NEUTRAL_DANGER`). The party's **last un-captured fighter is never
netted**. The **first** catch raises the alarm and Combat begins; if no one is caught
but the net has **reached the protected core** (or overrun the last safe tile), Combat
begins anyway — with **nobody taken**.

A unit may **Dig In**: hunker on its tile for a **sharply reduced** capture chance, at
the cost of its turn. The stance **holds across turns** until the unit moves or acts
(modelled like a status effect — moving clears it in `moveUnit`, an act clears it in the
deploy act seams). A unit that **opens a turn already dug in** is shown as *intentionally
out of action*: its row collapses to a single **Take Action** button (beside the usual End
Turn / Start Battle), signalling the deliberate hold. **Take Action** stands it back up into
a normal turn (revealing the full row) without breaking the stance — the capture benefit
holds until the unit actually moves or acts. As a QoL shortcut, **clicking a tile to move**
also re-engages a dug-in unit directly (the move clears the stance), so the reach stays lit;
Take Action is the no-move path back in. Or simply **hold safe ground** — place nothing,
take zero risk, be ready when Combat starts. Deployment is opt-in per unit: *range forward
(more setup, more risk)* vs. *hold / dig in (safe, less setup)*.

> **Render parity with Combat (the shared scene path).** A deploy turn now reads like a
> combat turn: the active unit's **reachable tiles light** (the reach wash) and a hover
> lights the **route** for its remaining move budget, and a unit that takes an HP hit —
> e.g. springing a concealed enemy trap — **floats its damage and writes the combat log**,
> exactly as it would mid-battle (the FX bus is wired up front, not only at Start Battle).
> Only the genuinely **phase-specific** behavior branches: the capture-wave layer above is
> unchanged, and **engagement emerges from the board, not a ban** (D67 W7) — the enemy roster
> is **concealed** in staging (pre-positioned but not yet a valid target), so an attack simply
> finds no one to hit and the deploy row never offers a strike. This is the stealth/alarm
> invariant expressed as board state: a scenario that stages **un-concealed** defenders (a keep
> assault) makes the *same* attack work in pre-combat, with no special rule.

What shapes the gamble (see [Stats](systems/stats.md)):

| Lever | Role in Deployment |
|---|---|
| **Presence** (party) | **Territory.** A unit's attack + defense + a tenth of its HP; the party's sum sizes the campfire's **protected core** (capped to the board). A heavier party — the trade-off for fewer fast infiltrators — holds *more guaranteed-safe ground* to position and prep within. |
| **Awareness** (unit) | **Eyes.** Spots concealed enemy traps (D12) and feeds the intel read; it doesn't itself enlarge the core. |
| **Speed** (unit) | **Throughput.** Capture is on the *net's* clock, so a faster party earns **more positioning turns between net-closings** — more setup for the same risk. (Also the unit's Combat CT stat.) |

High party **morale** and a **scouted / [intel](systems/intel.md)** read now **trim the
capture risk on neutral (open) ground** (the `exposureMultiplier`, folded in `deployMods`)
rather than enlarging the immune core — so a confident, well-scouted party can **range out
of the core more safely** (D8/D10). The net's own rate is untouched: once the net is on
you, only dig-in and an infiltrator's evasion help.

### Capture — the cost of overreach

When a capture roll lands on the net's turn (only for an **unprotected** unit — neutral
or netted), the unit is **captured** — left **bound on the map where it stands** (D63; the
capture only sets flags in place, `deployment.ts`, and the net drops where the unit is — no
repositioning into an enemy safe zone; that was a D11 leftover). A captured unit:

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

> **Captive recruits (D52 extension).** Not every bound token is one of *your*
> overreaches. Authored content can *start* an encounter with a **captive recruit** on
> the board (`AuthoredEncounter.captives`) — a guarded unit that **isn't yours yet**. It
> is **visible during Deployment** (a captive is not a concealed enemy), bound and off
> the clock, and freed by the same rescue Act mid-Combat — but freeing it (or **winning**
> the field) **recruits it permanently**. The demo's L1 Cook is the first; see
> [the Hollow Mill L1](expedition-hollow-mill.md) and [Combat §3](03-combat.md).

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
- The exemplar enemy entity is the **Snare**. *(**Designed, not built** — the snare's
  drag-into-**capture-mid-battle** countdown is deferred, D12/#148; today a snare deals
  damage + **Immobilized** only, `status.ts`.)* See
  [field-entities](systems/field-entities.md).

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
> `1 × fire-rune reagent`, and Vale's arrows already on her. A sturdy party, so the
> **campfire's protected core** gives a solid pocket of staging ground; the enemy
> danger source starts cold at the far edge.
>
> 1. **Bram** (Survivalist) spends his turns inside the protected core, planting **both
>    trap kits** at its forward edge. No risk taken — the core is **capture-immune**.
> 2. **Vale** (Scout, **high Speed**) uses her extra positioning turns to range **out of
>    the core into open ground**, near the enemy approach, and **place the fire rune** on
>    a deep tile — accepting the **neutral-ground capture risk** for the value (a Scout's
>    evasion softens it). The board flags her tile **Warning** — the net takes it next
>    turn. The player gambles and leaves her there.
> 3. The clock steps to the **net's turn**: the danger radius grows over Vale's tile
>    and rolls capture. ✗ — **Vale is netted**, bound on the map, and the **alarm
>    goes up**.
>    - The side is now **3 active + 1 captured**.
>    - Vale's Speed drops from the **initiative seed** → the **enemy side acts first**.
> 4. **Rook** (Soldier) and **Ember** (Mage) had **held safe ground** behind the trap
>    line — ready, well-placed. The alarm starts Combat with everyone where they
>    stand: 2 traps armed at the canyon mouth, 1 fire rune live near the enemy
>    approach, Vale captured on the ledge, enemy holding the initiative. On to **Combat**.

## Open questions / future scope

- Exposure model is **resolved + built** (D63 — the closing net; supersedes the
  never-built D11 retreat-race): two radial sources on the CT clock — a campfire
  **protected core** (capture-immune, presence-sized, **capped to board width**) vs. an
  enemy danger source that grows one step per net turn. **There is no free ground:**
  capture is rolled **on the net's turn** for every *unprotected* unit (neutral ground a
  flat lower rate, the net near-guaranteed), deepest first, last fighter spared; **Dig In**
  and an infiltrator's evasion reduce it, and morale/intel trim the *neutral* rate
  (`exposureMultiplier`). The net reaching the protected core **breaches** (combat starts,
  nobody taken) — the soft consequence vs. capture out in the open. Only the
  radius/cap/growth/rate numbers are tuning. **Architecture:** Deployment is a true phase of
  `Battle` on the **Battle's own CT clock** (D67) — not a parallel class *or even a second
  instance*: staging configures `battle.clock` (narrow turn-taking to active players, attach
  the enemy front as a strict-lead *tempo source*), and the deploy→battle handoff is a single
  logged `beginBattle` boundary (also the `battleBegan` event) that sheds that config and
  re-seeds the clock for the full-roster fight. Repositioning and
  skill-casting use the **same** `moveUnit`/`useSkill` verbs as combat; the interpreter reads
  `Battle.phase` and skips only the combat **turn-end** in pre-combat — the cast still **arms
  its cooldown** (D67 W5: an ability used in staging cools toward combat), and the scene plays
  the same heal/buff impact pop; only the **strike** FX and the auto-end-into-AI continuation
  stay combat-only. **Engagement is board state, not a per-phase ban (D67 W7):** the enemy
  roster is **concealed** in staging — pre-positioned but not yet a valid target — so an attack
  finds no one to hit and sits idle (the stealth invariant as a property of the board, not a
  `usableContext` refusal). A per-unit flag, so a scenario can stage **targetable** pre-combat
  foes (a keep assault) and the same verbs just work; future intel-reveal / ghost tokens layer
  on the same flag. See the
  [unification plan](../../scratchpad/foundations/deployment-combat-unification-plan.md).
- Enemy-prep symmetry is **resolved** (D12): A3 fortified-encounter type;
  Intel/Awareness-gated detection; Act-cost disarm or route-around. *(The Snare's
  drag-into-in-combat-capture is **designed, not built** — deferred, D12/#148; snares
  Immobilize + damage today.)* See [field-entities](systems/field-entities.md).
- Guard composition for captured units (how hard a rescue is) is encounter-driven;
  generation rules come with the run loop (M6).
