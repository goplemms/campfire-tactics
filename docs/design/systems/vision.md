# System — Vision & fog of war

> Referenced by: [Combat](../03-combat.md) (targeting), [Deployment](../02-deployment.md)
> (concealed/infiltration deploys), [Intel](intel.md) (pre-battle twin),
> [Stats](stats.md). Decision: **D18**.

> ## ⚠️ Mostly designed, not built (D18 / #148)
>
> The full **Hidden → Pinged → Seen** ladder, **ghost markers**, the **Awareness ping**,
> and the **ambush-from-Hidden** bonus described below are **deferred** (owner ruling:
> defer with this banner, #148 — not descope). **What ships today** (`vision.ts`, a ~68-line
> seam):
> - a **sight-radius** visible-tile set (`computeVisibleTiles`) + `canSee(side, tile)`;
> - **fog-respecting AI** (the AI only acts on what its side can see, `ai.ts`);
> - the **D68 Stealth status** — a "hidden" buff read by `canSeeUnit` (`status.ts` `isStealthed`),
>   from the Assassin's **Hidden Passage** (unseen unless a foe stands adjacent);
> - **D44 hidden ambush bodies** — authored enemies concealed until scouted (`authored.ts`).
>
> A full build would reconcile the ladder with those already-landed pieces. Everything
> below is the design intent.

## Description

Combat has **symmetric fog of war** — each side sees only what its units perceive.
It's the **in-battle twin of [Intel](intel.md)**: same "lift the fog" fantasy, at
combat timescale. Terrain shape is always known; what fog hides is **enemy units and
undetected enemy [field entities](field-entities.md)** (D12).

### The information ladder (banded)

| State | You know | How |
|---|---|---|
| **Hidden** | nothing (or a **last-seen ghost** if previously spotted) | out of all perception |
| **Pinged** | a presence is **there** — location, *not* identity | **Awareness** sense: a radius that **ignores line-of-sight** (you feel them through a wall) |
| **Seen** | full info (who, stats, facing) | **sight radius + line-of-sight** (terrain/elevation block it) |

**Ghost markers:** spot an enemy, then lose them, and you keep a *last-seen* marker —
ducking into fog is a feint, not teleportation.

### Two senses

- **Sight** — per-unit **radius + LoS**; blocked by terrain/elevation. Grants **Seen**
  (full identification). Elevation now buys vision on top of combat.
- **Awareness ping** — a sense radius that **ignores LoS** and grants **Pinged**
  (presence/location, no identity). This is Awareness's **in-combat** role (it was
  deployment-only); a high-Awareness party is simply *harder to sneak up on*.

### Interactions

- **Concealment payoff:** a unit that breaks from **Hidden** lands an **ambush bonus**
  (first strike from concealment hits harder) — what makes infiltration worth the
  risk. Being **Pinged** *partially defuses* the ambush (they knew you were there);
  being **Seen** removes it.
- **Targeting:** direct attacks/casts require **Seen**. **AoE** can hit any tile you
  perceive — including a **Pinged** blip (lob it at the presence, hope for the best) —
  but you can't cleanly *direct-target* an unidentified thing.
- **Intel tie-in:** a **Tier-3 intel** read (enemy positions) grants **starting
  vision** of the enemy's deployment — pre-battle investment buys an early sight edge
  you then have to maintain.

### M3 implication

Adds a **visibility layer** over the grid, recomputed per side each turn (Hidden /
Pinged / Seen + ghosts), which the trigger bus consults for **targeting** legality.
Worth building into M3's foundations, not retrofitting.

## Pseudo-example

> - **Rogue** infiltration-deploys into fog and stays **Hidden**; when she strikes,
>   it's an **ambush** (bonus damage).
> - **Archer** has a flier in **sight + LoS** → **Seen** → fires a clean shot.
> - A high-**Awareness** scout **pings** a blip *behind a wall* — knows *something's*
>   there but not what; the mage **AoEs the tile** on spec rather than direct-casting.
> - An enemy ducks around a corner → drops from **Seen** to a **ghost marker** at its
>   last tile; the party plays around where it *probably* went.

## Open questions / future scope

- Exact **sight** and **ping** radii (banded), and elevation's vision rules: tuning.
- **Stealth as a stat/trait** (some units harder to spot / better sight): still deferred
  as a *stat/trait*. Note a Stealth **status** did ship (D68 Hidden Passage — the Assassin
  vanishes unless a foe stands adjacent, read by `canSeeUnit`), so the "hidden unit" primitive
  now exists even though the passive stat/trait axis does not.
- Whether a **Pinged** contact upgrades to **Seen** by closing distance / gaining LoS
  (assumed yes): confirm at implementation.
