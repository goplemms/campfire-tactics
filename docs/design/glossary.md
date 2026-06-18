# Glossary — canonical keywords for player-facing text

> Referenced by: [Design Overview](README.md), [The overworld](systems/overworld.md)
> (the node lifecycle / D46 terminology note this doc lifts and extends).
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

## Lifecycle — the node spine (D46)

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
> (D34). **"Burn"** stays flavor/forecast prose for *upkeep-per-step*; the readout
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
| **Guard the purse** | The Banker's SECURE verb: blunt a thief's skim. | **"Protect"** — the button says `Guard`, its own tooltip says `protection`/`protect`. **Pick `Guard`** for the verb; "protection" may appear in *explanatory* tooltip prose. |
| **Invest** | The Banker's interest verb (purse accrues interest per step). | "Save"; "Deposit" |
| **Borrow** | The Banker's buy-on-debt verb. | "Loan"; "Advance" |
| **Gather Influence** | The Noble's INFLUENCE verb. | "Earn rep"; "Curry favor" (in the label) |
| **Trade** | The Merchant camp skill (+gold, +storage). | "Sell"; "Deal" |
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

> The design doc (D46) already bans reusing "rest" for the *gate*. This extends that
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

## Drift to reconcile (current build → canon)

Not action items for this doc, but the known gaps a future copy pass closes:

1. **Market vs Shop vs Roadside Market** → verb is `Market` everywhere; event keeps
   its flavor name, its buy button reads `Market`.
2. **Guard vs Protect** → button + readouts say `Guard`; "protection" only in
   explanatory prose.
3. **Bare "Rest"** → always qualified (`Rest node` / `Rest Points` / `In-place rest`
   / `Triage Heal`).
4. **`Review Route Map` vs `Survey`** → "Review" is fine as the read-only *map*
   button; the *screen* is always `Survey`. Don't let "Review" name the planning beat.
5. **Currency suffixing** → run pool is `Purse`, amounts carry `g`; Influence never
   carries `g` and never joins a gold sum.

## Adding a term

When you write a new player-facing label:

1. Find the concept here. Use the canonical word. If a synonym is tempting, it's in
   the banned column for a reason.
2. If the concept is **new**, add a row before you ship the label — and check it
   doesn't collide with an existing keyword's mechanic.
3. Keep it in the right layer: **clickable or numbered → Layer 1 (canonical);
   read-only prose → Layer 2 (flavor allowed).**
