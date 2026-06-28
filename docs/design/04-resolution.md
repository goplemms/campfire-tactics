# Phase 4 — Resolution

> Pipeline position: `Pre-deployment → Deployment → Combat → [RESOLUTION] ↺`
> Related systems: [Logistics & inventory](systems/logistics.md)

## Description

Resolution closes a battle and **feeds the next** [Pre-deployment](01-pre-deployment.md).
It is short but it is where the **logistics loop completes** — the consequences of
provisioning and prep are tallied and folded back into the run.

It resolves four things:

1. **Material recovery (D13).** Recovery is **outcome-gated and whole-field**: a
   **win** means you control the *entire* battlefield, so you recover **every**
   unsprung, intact entity left standing — **including the enemy's** (salvage into
   your storage). **Flee or lose → nothing.** What's actually recoverable is bounded
   by each entity's **durability** (multi-use *charges* and whether its material
   *survives* use — rune dust is "wiped away" and gone even on a win); see
   [logistics](systems/logistics.md).
2. **Capture & downed outcomes.** Allies **rescued** during Combat return to the
   roster normally. **On a win, any still-captured ally is auto-rescued (D21)** —
   victory means you control the field, so your bound people come home (the same
   "control the field" principle as material recovery below). The **rescue
   follow-up quest** applies only to **non-win** outcomes (flee/lose with a captured
   unit) or **abandoning** the rescue; a unit downed to 0 is resolved by the
   difficulty's consequence policy (dying timer, ½-HP redeploy, etc.). The **cleric**
   revive and **Rest-Point** recovery that follow in camp are defined in
   [mortality-recovery](systems/mortality-recovery.md) (D9).
3. **Rewards.** Loot, gold (boosted by the **Merchant**), and any encounter-specific
   spoils. Consumables actually spent (arrows fired, traps sprung) are deducted —
   the fight's true logistics cost is realized here.
4. **Morale & state.** Outcomes adjust party **morale** (a clean rescue lifts it;
   *abandoning* an ally drops it more than a hard-fought loss — see
   [morale](systems/morale.md)), and the **Cook's** banked buffs are reconciled. Run
   state (survivors, inventory, gold, seed position) advances.

The output is an updated **run state** that becomes the starting condition for the
next Meta/Pre-deployment phase, until the run ends in victory or death.

## Pseudo-example

> Continuing from Combat: the party won the canyon fight and **held the ground**.
>
> 1. **Material recovery.** Both traps **sprung** (gone). The fire rune was
>    **detonated** (gone). But **1 spare trap kit** was never deployed and a downed
>    **enemy snare** is intact — both **salvaged** to storage (a clean win controls
>    the whole field).
> 2. **Captures.** Vale was **rescued** mid-fight → she returns to the roster
>    unharmed (if she'd been left bound at battle's end, she'd be **dead**).
> 3. **Rewards.** Loot + **180 gold** (Merchant bonus applied). Spent consumables
>    (`18 net arrows`, `1 rune reagent`) **roll their recovery keyword** — a few net
>    arrows return — and the rest are deducted from the ledger.
> 4. **Morale & state.** The rescue lifts party **morale +1**; the Cook's banked
>    stew heal was consumed at battle start, so it clears. Run state updates: 4
>    survivors, storage now holding the recovered kit + salvaged snare, 180g — ready
>    to pay next night's **Upkeep**.
>
> Control returns to **Pre-deployment** for the next encounter — now with a little
> more gold and salvage to re-provision around.

## Open questions / future scope

- Recovery is **resolved** (D13): outcome-gated, whole-field, win-recovers-all
  (incl. enemy salvage), bounded by entity durability. **Ammo** handling is parked
  for a **dedicated follow-up** (the "ranged feels bad when empty" balance), as is
  the conditional **Survivalist salvage perk** on spent-ammo pickups.
- Morale's feedback is **resolved** — passive tiered modifiers, see
  [morale](systems/morale.md) (D8); magnitudes remain tuning.
- Full run-state persistence, seeding, and the death screen come with the
  roguelike run loop (milestone M6).
