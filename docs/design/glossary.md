# Glossary — canonical keywords for player-facing text

> Referenced by: [Design Overview](README.md), [The overworld](systems/overworld.md)
> (the node lifecycle / *D46* terminology note this doc lifts and extends).
> Scope: **the words the player reads** — node menus, buttons, HUD readouts, hints,
> tooltips, event panels. Not internal identifiers (those are code's business).

This is the **single source of truth for terminology**. Today every label is
authored inline at its call site (`OverworldScene.ts`, the `core/*` data records),
so synonym drift is the default — the same idea wears three costumes across three
screens. This doc names **one canonical term per concept** and lists the synonyms
that are now **out of bounds** in labels.

## The two-layer rule

We keep the evocative voice *and* the legibility by splitting where each lives:

- **Layer 1 — canonical (labels & mechanics).** Anything the player must parse to
  make a decision: **button text, HUD readouts, status tiers, tooltips, the node
  legend, action names.** These use the canonical keyword from the tables below,
  **every time, with no synonyms.** A keyword means exactly one mechanic.
- **Layer 2 — flavor (prose).** **Event teasers, outcome lines, story prompts,
  terminal screens.** Here the voice runs free — "skims the purse," "the caravan's
  mood sours," "a cold unease follows." Flavor may *describe* a mechanic
  colourfully, but the moment it becomes a **clickable label or a number's name**,
  it snaps back to the Layer-1 keyword.

> Rule of thumb: **if you can click it or it carries a number, it's Layer 1.** If
> you only read it, it can be Layer 2.

## Label grammar (Layer 1 conventions)

Predictable shape makes copy scannable without reading every word:

- **Action buttons — `Verb the Noun`.** `Make Camp`, `Break Camp`, `Buy Trap Kit`,
  `Triage Heal`. Imperative verb first, canonical noun second. The cost rides in a
  trailing ` (…)` or ` · …` clause, never inside the verb phrase.
- **Commit buttons — `End the Night — <what fires>`.** One pattern for the gate that
  advances the game, branching on node kind (see Lifecycle). `Break Camp →` is the
  *only* other advance verb, reserved for departure.
- **Status readouts — `Noun Value` or `Noun Tier (Value)`.** `Purse 120g`,
  `Morale High (3)`, `Fatigue Weary (2)`. Noun first, then the number or band.
- **Cost clauses — `cd: N · fatigue: N · gold: Ng`.** Same order every time
  (cooldown → fatigue → gold), so the eye learns the slots.
- **Capitalize the keyword (in labels & readouts).** A canonical resource/status noun
  is **Capitalized in every persistent, scannable surface** — buttons, HUD lines,
  status chips, panel headers, list readouts: `Guard the Purse`, `Gather Influence`,
  `Slots 2/4 · Storage 6 · Purse 40g`, `Debt 40g · Interest +2g/step`. This visually
  links an action to its HUD number (the `Purse 120g` you read up top is the `Purse`
  you Guard). **Transient hint *sentences*** (refusals, confirmations like "Treasury
  can't cover the purse") may keep natural sentence casing — they read as prose, not as
  labels.

## Lifecycle — the node spine (*D46*)

The one canonical sequence. These four are **fixed keywords**; never substitute.

| Canonical | Means | Banned in labels |
|---|---|---|
| **Make Camp** | The *pre-event* prep surface at a node (provision, heal, read the ledger). | "Camp" alone as the commit; "Prep"; "Setup" |
| **End the Night** | The gate — the night passes and the node's event fires by kind. | "Begin"; "Start"; "Go"; "Confirm"; any "rest" wording |
| **Survey** | The *post-event* planning beat (forecast, in-place rest, scout). | "Plan"; "Review" (as the screen name) |
| **Break Camp** | Depart to the next node; the node-step tick fires here. | "Leave"; "Travel"; "Move on"; "Continue" |

**Commit-button forms** (the only sanctioned variants of the gate):

| Node kind | Button |
|---|---|
| combat | `End the Night — Begin Mission` |
| rest | `End the Night — Rest` |
| event | `End the Night — Approach the Event` |

> Note the one sanctioned exception to the "no rest for a gate" rule: `End the
> Night — Rest` is allowed **because the node kind is literally Rest** — the gate
> verb is still "End the Night," with "Rest" naming *which event fires*.

## Surfaces & hubs (*D58*)

The run's deep-info lives in **one** hub with **one** idiom — a bounds-driven
overlay that floats over the live overworld (no scene swap). One verb opens it;
a tab bar switches view. Each datum is single-sourced to exactly one tab.

| Canonical | Means | Banned in labels |
|---|---|---|
| **Captain's Tent** | The single deep-info hub for a run (opened from Make Camp / Survey). | "menu"; "panel"; "screen"; "Dossier" *as the hub name* |
| **Party** (tab) | The roster readout — per-member vitality, jeopardy, growth, stats (the dossier). | "Dossier" as the tab label; "Roster" (that's the guild pool) |
| **Stores** (tab) | The caravan manifest — party/storage caps, carried stock, purse. | "Inventory"; "bag"; "pack" |
| **Ledger** (tab) | Gold flow (realized + projected) + the route forecast. | "Accounts"; "Budget" |
| **Map** (tab) | The read-only route board (hands off to the full board, ← Back returns). | "Overview"; "World" |

> The Tent **converges** what were three scattered surfaces (a dossier scene, an
> inventory panel, a nested ledger). Party owns *vitality*; Stores owns
> *logistics*; Ledger owns *gold* — they never mirror each other.

## Currencies & resources

| Canonical | Means | Banned in labels |
|---|---|---|
| **Purse** | The carried **run** gold (lost on a wipe). The field-spend pool. | bare "gold" *when you mean the run pool*; "money"; "funds" |
| **Treasury** | The persistent **guild** vault (quest payouts only). | "bank" (collides with the Banker class); "savings" |
| **Influence** | The Noble's separate currency; **never** pays Upkeep. | "rep"; "reputation" (in labels); "favor" |
| **Upkeep** | The nightly maintenance cost (Food + Repairs lines). | "maintenance"; "costs"; "burn" *as a label* (see below) |
| **Storage** | Caravan slot capacity for gear/ammo/consumables. | "inventory"; "bag"; "pack" |
| **Rest Points (RP)** | Banked support-role healing currency; spent via Triage. | spelling out "rest" ambiguously near a rest node |
| **Debt** | The Banker's outstanding borrow, auto-repaid from run gold. | "loan" (in readouts); "owed" |

> **`g` suffix** marks gold amounts (`120g`, `pay 8g`). **Influence is never
> suffixed `g`** and never summed into a gold total — that separation is load-bearing
> (*D34*). **"Burn"** stays flavor/forecast prose for *upkeep-per-step*; the readout
> noun is **Upkeep**.

## Map & nodes

| Canonical | Means | Banned in labels |
|---|---|---|
| **Node** | A single location on the run map. | "stop"; "tile"; "space" |
| **Run** | One caravan's start→final playthrough. | "game"; "level"; "dungeon" |
| **Night** | One in-game night; one node = one night. | "turn"; "day" |
| **Layer** | A column in the DAG; layer = difficulty index. | "depth" *in labels* (keep for prose); "stage" |
| **Reachable** | A node you can travel to from here now. | "available"; "open" |
| **Fogged** | Out of intel reach; hidden until intel reaches it. | "hidden"; "locked"; "unknown" |
| **Intel** | The banded pre-knowledge that reveals nodes. | "scouting" *as the noun*; "vision" (that's the in-battle twin) |
| **Forecast** | The ledger's purse-at-the-bottom route projection. | "prediction"; "estimate" |

## Status bands

Each banded status keeps its own ladder, but the **readout shape is shared**
(`Noun Tier (Value)`) so the player learns one pattern.

| Status | Tiers (low → high) |
|---|---|
| **Morale** | Low · Neutral · High · Inspired |
| **Fatigue** | Rested · Worn · Weary · Exhausted |
| **Intel** | (Fogged →) Tier 1 · Tier 2 · Tier 3 |

> Banned: inventing a synonym tier ("Tired" for Worn, "Eager" for Inspired). The
> ladder words *are* the keywords.

## Actions & verbs

The collision-prone set. **One verb, one mechanic** — these are the resolutions for
the drift found in the current build.

| Canonical | Means | Banned synonyms (and why) |
|---|---|---|
| **Scout** | Raise a node's intel preview one tier. | — (already clean) |
| **Market** | The Merchant's ACCESS verb: open a market to buy supply. | **"Shop"** — the button `Shop the market`, the ability `Market`, and the event `Roadside Market` are three skins of one verb. **Pick `Market`** for the verb; the *event node* may keep its flavor name (Layer 2) but its buy action reads `Market`. |
| **Triage Heal** | Spend RP to heal the most-wounded one chunk. | "Heal" alone; "Patch"; "Mend" |
| **In-place rest** | The repeatable Survey-beat recovery (rations → RP + small heal). | "Rest" alone (collides three ways — see below); "Camp here" |
| **Guard the Purse** | The Banker's SECURE verb: blunt a thief's skim. | **"Protect"** as the *verb*. Two-part rule: **`Guard`** is the verb/button; **`Protection N%`** is the resulting status readout (the effect's magnitude). Never `Protect the purse` as an action. |
| **Invest** | The Banker's interest verb (purse accrues interest per step). | "Save"; "Deposit" |
| **Borrow** | The Banker's buy-on-debt verb. | "Loan"; "Advance" |
| **Gather Influence** | The Noble's INFLUENCE verb. | "Earn rep"; "Curry favor" (in the label) |
| **Trade** | The Merchant camp skill (+gold, +storage). ⚠️ **Retired by D61** — the gold-minting Trade is dropped; the Merchant verb becomes node-tier **access** (buy) + **Sell**. **"Sell" is being promoted to its own keyword**, so it is no longer a banned synonym here. Re-author this row + add **Valuables**/**Salvage** when D61 builds. | (was "Sell"; "Deal") |
| **Cook Stew** | The Chef camp skill (+morale, banks heal). | "Cook" alone if other dishes ever exist |
| **Set Trap** | The Survivalist deployment skill. | "Lay trap"; "Plant trap" |

### The "Rest" overload — the headline fix

**"Rest" currently names four different things.** Canon disambiguates by *never
letting bare "Rest" stand alone as a clickable label*:

| What it is | Canonical label | Never just say |
|---|---|---|
| A node kind themed on recovery | **Rest node** (`End the Night — Rest`) | "Rest" (as a button) |
| Banked healing currency | **Rest Points (RP)** | "Rest" |
| The Survey-beat recovery action | **In-place rest** | "Rest" |
| Spending RP on the wounded | **Triage Heal** | "Rest" / "Heal" |

> The design doc (*D46*) already bans reusing "rest" for the *gate*. This extends that
> ban: bare "Rest" is **only** ever the node kind's event name; every other meaning
> carries its qualifier.

## Event nodes (Layer 2 names, Layer 1 actions)

Event **node names and teasers are flavor** (Layer 2) and stay evocative. Their
**buttons are Layer 1** and use canonical verbs.

| Event (Layer 2 name) | Flavor teaser stays | But its actions read (Layer 1) |
|---|---|---|
| **Roadside Market** | "spend purse gold on supplies" | `Market` / `Buy <item> (Ng)` / `Leave` |
| **Wandering Sellsword** | "hire a body for purse gold" | `Hire <name> (Ng)` / `Decline` |
| **Thief on the Road** | "it skims the purse" | (auto-resolves; outcome is prose) |
| **Tollgate** | "a known fee to pass" | (auto-resolves; fee shown in Forecast) |
| **A Choice on the Road** | story prompt + options | options are flavor; consequences are prose |

## Guild hall & caravans (*D25–D34*)

The home tier. Plenty of vessel flavor (Stable, Dispatch, In Flight) — but the
**people-and-pool nouns must not drift**, since the guild and a caravan both hold
characters.

| Canonical | Means | Banned in labels |
|---|---|---|
| **Roster** | The guild's **whole pool** of characters. | "team"; "crew"; "stable" (that's the caravans) |
| **Party** | The characters assigned to **one caravan**. | "crew"; "Aboard" (as the noun/count); "squad" |
| **Slots** | Uniform party-capacity units on a caravan. | "seats"; "berths" |
| **Caravan** | The expedition unit you assemble and dispatch. | "expedition"; "wagon" (in labels); "party" (that's its people) |
| **Vessel** | A caravan *type* (`Scout Cart`, `Supply Train`). | id forms (`scout-cart`) in player text |
| **Dispatch** | Commit a caravan to a quest and begin its run. | "Send"; "Launch"; "Deploy" (that's the battle phase) |
| **Treasury** | The guild's persistent gold vault. | "bank"; "coffers" |
| **Armory** | The guild's free (unlocked) gear store. | "stash"; "vault" |
| **Locked gear** | Equipment committed to a caravan, unavailable elsewhere. | "reserved"; "assigned gear" |
| **Quest Board** | The never-empty quest feed (main + side). | "missions"; "jobs board" |
| **The Stable** | Where caravans sit (assembling / in flight / empty). | "garage"; "fleet" (in the label) |
| **Hire** | Recruit a **Mercenary** with gold. | "Buy"; "Recruit" *as the gold verb* (Recruit is the broad concept) |

**Roster tiers (*D33*)** — fixed keywords, never re-skinned: **Mercenary** (gold-hired,
expendable) · **Companion** (authored, earned not bought) · **Lord** (authored,
campaign-critical; death = game-over).

## Deployment (*D7/D11* · the on-map setup phase)

The "earlier that day" placement phase — distinct from the guild's **Dispatch** and
the overworld's **camp**. Flavor lives in the spotted/netted prose; the meters and
buttons are Layer 1.

| Canonical | Means | Banned in labels |
|---|---|---|
| **Deployment** | The on-map pre-battle placement phase. | "Setup"; "Positioning" |
| **Trap Kit** | The consumable that places a trap on a tile. | "trap" alone *for the item*; "snare kit" |
| **Camp alert** | The deployment exposure meter (0–100%). | "exposure"; "detection"; "heat" |
| **Cover** | The zero-risk deploy region ("in cover" / "past safe"). | "safe zone" *and* "cover" both — pick **Cover** |
| **Captured** | A unit netted past safe; bound in the enemy zone until rescued or the fight is won. | "netted" (as the status word — fine in the *event* prose); "bound" |

> **One small split to hold:** the **event prose** may say a unit was *spotted* /
> *netted* / *bolting for cover* (Layer 2); the **status word** on the HUD is
> **Captured** and the region word is **Cover** (Layer 1).

## Combat (*D5* · the CT clock)

The isometric battle. The clock vocabulary is fixed canon — players learn it once and
read it everywhere.

| Canonical | Means | Banned in labels |
|---|---|---|
| **CT clock** / **Charge-Time** | The continuous initiative clock (no rounds). | "ATB"; "initiative bar"; "timeline" (in labels) |
| **Advance Clock** | The button that ticks the clock to the next turn. | "Next turn"; "End turn"; "Tick" |
| **Turn order** | The rail showing who acts next. | "initiative"; "queue" |
| **Speed** | The stat governing how fast CT fills. | "AGI"; "initiative" |
| **active turn** = **Move** + **Act** | One unit's turn: move and act, either order. | "action"; "AP" (no action-point pool) |
| **Charging** | A unit mid **Charged** ability (the `◷` glyph). | "casting"; "winding up" |
| **Instant** / **Charged** | Resolves now / schedules and **resolves later**. | "quick"/"slow"; "channeled" |
| **Defend** | The universal brace action (applies the **Guarded** status). | "Brace"/"Block" as the *button*; "Guard" (that's the Banker verb) |
| **Wait** | Pass the turn without acting. | "Skip"; "Pass"; "Hold" |
| **Bribe** | The Noble's mid-combat **Influence** verb (sway an enemy). | "Sway"/"Charm" as the button; abbreviating `Influence` to `Inf` |

**Status-effect lexicon** — fixed labels, one word each, never re-skinned:
**Immobilized · Slowed · Exposed · Hastened · Guarded · Swift · Marked Prey · Flanked**.
New statuses follow the pattern (a single capitalized adjective/noun); check this list
before coining one so two effects never share a word.

**Vision ladder (*D18*):** the canonical tiers are **Hidden → Pinged → Seen** (with
**ghost markers** for spotted-then-lost foes, and an **ambush bonus** for breaking from
Hidden). These are **design canon**; in-battle *prose* may stay evocative ("stirs in
ambush," "springs from cover") — but any **tier label or legend key** uses the ladder
words.

> **Two "Guard"s, kept apart:** combat **Guarded** = the Defend brace (damage
> reduction); the Banker's **Guard the Purse** = theft protection (readout
> **Protection N%**). Different tiers, never cross-labeled.

## Drift status (current build → canon)

The first copy pass found the live strings already mostly disciplined. State:

1. **Market vs Shop** — ✅ **fixed.** The camp button (`Shop the market` → `Market`)
   and the node legend label (`shop` → `market`) now use the canonical verb. The
   internal node-kind key stays `shop` (code's business); the event keeps its flavor
   name **Roadside Market**, its buy buttons read `Buy <item>`.
2. **Guard vs Protect** — ✅ **already compliant.** The button reads `Guard the purse`;
   "protection" appears only in explanatory tooltip prose, as canon allows.
3. **Bare "Rest"** — ✅ **already compliant.** Every meaning is qualified (`Rest node` /
   `Rest Points` / `Rest in place` / `Triage Heal`); bare `Rest` survives only as the
   rest-node event title (the sanctioned node-kind name).
4. **`Review Route Map` vs `Survey`** — ✅ **already compliant.** "Review" names the
   read-only *map* button; the planning *screen* is always titled `Survey`.
5. **Currency suffixing** — ✅ **already compliant.** Run pool is `Purse`, amounts carry
   `g`; Influence never carries `g` and is never summed into a gold total.

Guild + deployment pass:

6. **Caravan-member nouns** — ✅ **fixed.** The guild scene called the same people
   `Aboard` / `crew` / `slots`. Now: **Roster** = the guild pool, **Party** = a
   caravan's members (`Aboard:` → `Party:`, `… crew` → `… party`), **Slots** = the
   capacity unit.
7. **Currency casing in labels** — ✅ **fixed.** Buttons/readouts that lower-cased a
   named currency now capitalize it (`Gather influence` → `Gather Influence`; `Invest
   the purse` → `Invest the Purse`; `Guard the purse` → `Guard the Purse`; the Banker
   chip's `interest`/`debt`/`protection` → `Interest`/`Debt`/`Protection`).
8. **Guild/deployment terms otherwise compliant** — Treasury, Influence, Storage, RP,
   Upkeep, vessel display names (`Scout Cart` / `Supply Train`), Quest Board, Armory,
   Dispatch, and the Deployment meters all already matched canon; only the two items
   above needed code changes.

Combat pass:

9. **Battle HUD `Gold` → `Purse`** — ✅ **fixed.** The in-battle camp readout labelled
   the run pool `Gold N`; it's the same `run.camp.gold` the overworld shows as `Purse Ng`.
   Now unified on `Purse Ng`.
10. **`Inf` → `Influence`** — ✅ **fixed.** The bribe button read `Bribe (3 Inf)` while
    its own error spelled out "Influence". Now `Bribe (3 Influence)` (no abbreviation —
    Influence is never shortened, unlike the sanctioned `RP`).
11. **Combat keywords otherwise compliant** — `Advance Clock`, `Turn order`, the status
    lexicon, `Defend`/`Wait`, Morale tiers, Storage/Kits/RP/Upkeep, and `Captured` all
    already matched canon; the fog prose stays Layer 2 by design.

## Adding a term

When you write a new player-facing label:

1. Find the concept here. Use the canonical word. If a synonym is tempting, it's in
   the banned column for a reason.
2. If the concept is **new**, add a row before you ship the label — and check it
   doesn't collide with an existing keyword's mechanic.
3. Keep it in the right layer: **clickable or numbered → Layer 1 (canonical);
   read-only prose → Layer 2 (flavor allowed).**
