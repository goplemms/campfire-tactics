# Example play session (annotated reference)

> A **living reference** of one full run, beat by beat, with each beat tagged by the
> system it exercises **and** its build status. Use it to **sanity-check changes**: when
> a system is revised, walk this trace and confirm it still hangs together (and tweak the
> beats to match). It is *illustrative*, not a spec — the specs are the other docs.
>
> **This trace follows the canonical demo** — *The Hollow Mill* (`src/core/hollow-mill.ts`,
> played by `DemoRunner`; the e2e/sim harnesses replay it deterministically). Data lives in
> [`hollow-mill.ts`](../../src/core/hollow-mill.ts) + the pinned events in
> [`node-events.ts`](../../src/core/node-events.ts); the intent lives in
> [`expedition-hollow-mill.md`](expedition-hollow-mill.md). When code and this doc diverge,
> **code wins** — update the beats.
>
> **Legend (status, not just "decided"):**
> - ✅ **built** — shipped and covered by tests.
> - 📐 **decided, not built** — backed by a recorded decision but **deferred**; carries a
>   "designed, not built" banner in its own doc (adjudicated in #148).
> - 🔶 **open** — surfaced by this trace but not yet fully designed.

**Cast (start):** **Edrin** / Soldier (lord, the anchor) · **Rook** / Hunter (ranged) ·
**Vale** / Scout (eyes + field-craft — Intelligence 7 floors intel at tier 2, Awareness 5
spots concealed snares). A visibly **healer-less** trio — the missing support is what the
three recruits (**Pip** the Cook, **Sela** the Medic, **Mira** the Merchant) fill across the
run. **Starting bundle:** purse 120 · `salve×2, stimulant×1, antidote×2, trap-kit×2` · storage
cap **5** (starts **full**) · morale 2 · difficulty Normal.

## L0 · Provisioning camp (`start`, rest)

| Beat | Exercises | Status |
|---|---|---|
| A campsite / world-menu, no grid — spend the opening purse, review the loaded stash | Meta / pre-deployment phase (D3/D46) | ✅ |
| The stash is already **5/5 full** (2 trap-kits + the medical pack) — storage felt from step one | Slotted storage, caravan-sized cap (D14/D79) | ✅ |
| Pay the night's **Upkeep** (one gold figure); underfunding a line hits morale + gear **immediately** | Upkeep, gold-as-solvent (D15) — *grace nights are* 📐 *(deferred, #148)* | ✅ |

## L1 · Skirmish at the Mill Yard (`e1`, combat) — the first fight *and* the first rescue

| Beat | Exercises | Status |
|---|---|---|
| Deployment plays on the board against a **closing enemy net** on the CT clock; the campfire's protected core is capture-immune | Closing-net deployment (D63/D67) | ✅ |
| **Vale** plants a **trap-kit** at the core's forward edge (Set Trap, her L1 kit), staying safe | Scout Set Trap (8 dmg + Exposed, D74) | ✅ |
| **Pip** is on the board from turn one — a **bound captive** in the captor's corner (col 7,r1), grey, off the clock, never an AI target | Captive recruit (D52) | ✅ |
| **Begin** the battle; the CT clock runs — Rook (Hunter) fires, Edrin closes | FFT CT clock (D5); ranged/melee | ✅ |
| The **captor sits apart** in his corner: **isolating him for the flank IS reaching Pip** — one shape, two lessons | Flank/isolation (D36) | ✅ |
| An ally reaches Pip and spends an **Act to free him** → he cold-joins the clock as a controllable unit (`unitRescued` fires) | In-combat rescue (D9/D21) | ✅ |
| Battle **won**; the win **always recruits Pip** (even unreached), banking the completion XP so he joins **leveled** (L2), not at base | Win-recruit guarantee + XP (D52/D39) | ✅ |
| The L1 win banks **every survivor to L2**; Vale's **Recon** unlock is announced | Per-job leveling (D39/D74) | ✅ |

## L2 · A Traveler on the Road (`camp2`, event → `provision-choice`) — the first clearing

| Beat | Exercises | Status |
|---|---|---|
| A roadside traveler **presses gifts unconditionally** — 2 trap-kits **+ the iron weapons** — a grant that **always lands, even over the cap** | Grants over-stuff; "items don't vanish" (D75) | ✅ |
| The stash was full, so the gift **forces a discard back to the cap** (discard menu, or headless `autoTrim` sheds lowest-value first) | Storage as a felt limit; forced discard (D79) | ✅ |
| The choice bites: **keep the iron-weapons party-gear** (a carried, party-wide +attack edge) **or** the snares **or** shed pre-Medic medical dead-weight | `iron-weapons` party-gear (D78) | ✅ |
| **Cook a Stew** (only because Pip lives) — banks **Rest Points** and satisfies the night's Food upkeep line, no double-charge | Cook Stew → RP (D71) | ✅ |
| **Vale uses Recon on the overworld** — scout the **L3 snares** node up a tier; paced by cooldown + fatigue | Overworld action economy + Survey/Recon (D35/D74/D80) | ✅ |

## L3 · The Sapper's Snares (`snares`, combat) — the field is the threat

| Beat | Exercises | Status |
|---|---|---|
| One lone bandit; the real danger is **five strong concealed snares** mid-field (dmg 22–26, no Medic yet) | Concealed enemy field entities (D12) | ✅ |
| **Intel reads the field** (D83): the trap lane bands presence → count → the **careless mark** — at tier 3 exactly **one** sloppy snare stages pre-revealed; the careful work stays hidden (intel *informs*, Awareness *resolves*) | Intel trap lane + rumors (D83) | ✅ |
| **Vale's Awareness** spot-rolls the rest as the party crosses; **Search** widens the sweep | Awareness trap-spotting (`traps.ts`) | ✅ |
| The straggler **holds his post** (`hold-skittish` leash), forcing the party across the field; the **first melee blow breaks him** → he **flees off-map**, ending the fight as a win (gone, not killed) | Standing-order behaviors (D81/D84) | ✅ |
| On the win, unsprung snares **sweep to the stash — only while a trap-trained survivor (Vale) still stands** | The snare sweep (D82) | ✅ |
| This node is the **L4 fork** — edges to 4A (rest) and 4B (the hard road) | Branching overworld (D22) | ✅ |

## L4B · The Prison Wagon (`wagon4b`, combat) — the hard road

| Beat | Exercises | Status |
|---|---|---|
| Take the risky fork: a softened **slaver-lieutenant** (the elite-tier intro) + detail, fought **before a healer** | Elite archetype; risk/reward routing | ✅ |
| Win → **Sela the Medic** is freed as an authored post-win grant, setting the `medic-freed` flag | Authored recruit grant (D52) | ✅ |
| The flag **gates the L6 Secured Wagon shut** (`blockedWhen: flagSet "medic-freed"`) — no double-freeing the Medic | Predicate node-access gate (`nodeAccessible`) | ✅ |

## L5 · Market Town (`market`, event → `merchant-town`) — the economy hub

| Beat | Exercises | Status |
|---|---|---|
| Every road reconverges here; the market opens at the **`basic`** tier | Node market tiers (D61) | ✅ |
| **Mira the Merchant** joins — buy/sell open, and a fielded Merchant's **Appraisal** lifts the market a tier | Merchant recruit + presence (D61/D70) | ✅ |
| Spend the purse on supplies; sell salvage — the two-pool economy (purse ≠ guild treasury) | Purse economy (D30/D34) | ✅ |

## L6 → L7 · The offshoot and the finale

| Beat | Exercises | Status |
|---|---|---|
| Route on via **The Thieves' Den** (`den`): thief enemies **skim the purse and bolt** — kill them to drop the gold, or lose it if they escape the edge | Theft/chase; `escape` posture (D30/D84) | ✅ |
| The Den grants a **`relic-hollow-blade`** — a build-defining unique | Relic / unique item — effect **TBD** | 🔶 |
| Reach the **stub finale** (`finale`) — a placeholder holdout so the run is completable | The finale is a **placeholder**; Layers 6–10 are undesigned | 🔶 |

## What the trace covers (and what it flags)

**Validated as one motion (all ✅ built):** the phase pipeline end to end (overworld →
closing-net deployment → CT-clock battle → resolution), the **rescue-as-recruit** arc (Pip
is a captive on the board, freed by the same rescue Act, recruited on the win), the
**storage through-line** (a tight cap → the traveler's gift overflows it → a real discard
choice between a party buff and utility), **intel as investment** (Recon a node ahead → a
sharper trap read at L3), **standing-order** enemies that hold and flee, and the three
recruits filling the healer-less gap (Pip/Sela/Mira). The demo is deterministic and replays
byte-identically from its seed.

**📐 Decided, not built — this run deliberately avoids depicting:** Vancian magic / runes
(D17), the D18 vision ladder (the demo uses sight-radius fog only), outcome-driven morale,
and the in-combat snare capture-countdown — all deferred with banners (#148). If a beat here
ever seems to lean on one, it is illustrative only.

**🔶 Still open:** the `relic-hollow-blade` effect, and the authored **finale** (Layers 6–10)
— the current L7 is a stub.

> **How to use this file:** when you change a system, find its beats above, confirm they
> still read sensibly against `hollow-mill.ts` + the sim/e2e behavior, and edit them. If a
> 📐 item ships, retag it ✅ and link its decision; if a 🔶 item gets designed, do the same.
