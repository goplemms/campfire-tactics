# System — Action catalogue (the verb glossary)

> Referenced by: [Design Overview](../README.md). Siblings:
> [Action economy / CT clock](action-economy.md) (D5, the *timing* of combat actions),
> [Combat actions substrate](combat-actions.md) (the command/replay/undo data shape), [Glossary](../glossary.md) (player-facing *terminology*).

## What this is

A **snapshot inventory of every player verb** in the game and **who owns it** — the
audit view we keep reaching for while designing. It answers, at a glance: *what can a
player do, on which surface, at what cost, and which class (if any) gates it.*

> **Maintenance:** this is a **periodic snapshot, not a live index.** It will drift as
> verbs are added or retuned — that's fine. Re-sync it when a design pass makes the
> drift inconvenient; don't treat a stale row as a bug. Code is the source of truth;
> the file/symbol in the **Code** column is where to confirm the current detail.

> **Scope:** verbs that **change game state by player intent**. Deliberately **out of
> scope**: pure UI/flow controls that carry no game decision — *Undo*, *Advance Clock*,
> *Start Battle*, animation-speed, and panel navigation (*Stores / Ledger / Review Route
> Map / Back*). The state-changing **commit gates** (*End the Night*, *Break Camp*) *are*
> included, under Lifecycle.

## The ownership model (gate types)

Every verb sits in exactly one of these gate categories — the spine of the audit:

| Gate | Meaning | Examples |
|---|---|---|
| **Class** | Hard-gated to a job: only that class can perform it (an enforced `jobIds` allowlist or a `has<Class>` party check). | Bribe → Noble · Survey → Scout · Banker verbs → Banker |
| **Capability** | Gated by *holding a capability* (a skill/passive), not a hard-coded job id — auto-extends to any future class with it. | Disarm (holds a trap skill) · Triage (Medic's Triage passive) |
| **Stat** | Open to anyone; **quality scales** with a stat. The class influence is soft. | Search (Awareness) |
| **Access** | Open wherever a resource/market exists; a class **extends the reach**, it isn't a hard gate. | Merchant Buy / Sell (market tier) |
| **Universal** | Any unit / any party, always. The floor verbs. | Move · Attack · Defend · Rest · Rescue |
| **Player / meta** | The guild-master's own actions — not a class verb at all. | Hire · Assign · Dispatch |

> **Design rule of thumb (this is the thing the audit enforces):** a verb that carries
> a **class's identity** should be **Class** or **Capability** gated. A verb that is a
> generic field/recovery action stays **Universal** (optionally **Stat**-flavoured). An
> economy verb that needs a *place* is **Access**.

---

## Lifecycle & run flow (overworld)

The outer loop's **flow commands** — not owned by anyone, but they *are* player
actions (route choice + the advance gates). They frame every other surface.

| Verb | Gate | Effect | Code |
|---|---|---|---|
| **Make Camp** | Universal | Select a reachable node to settle on (the prep surface opens) | `OverworldScene` → `runloop.choose` / `run.chooseNode` |
| **End the Night** | Universal | The commit gate — branches by node kind: *Begin Mission* (combat) · *Approach the Event* · *Rest* (D46) | `OverworldScene` → `runloop` (`startEncounter`/`eventNode`/`restNode`) |
| **Break Camp** | Universal | Depart back to the map (the soft, intent-aware gate; ticks the node-step) | `OverworldScene.breakCampToMap` → `run.breakCamp` |

## Combat actions (Battle phase)

Surfaced in `game/scenes/BattleScene.ts`; a unit gets **one Act** per turn (plus free
movement). Class skills come from `core/jobs.ts` (resolved by `core/skills.ts`).

| Verb | Gate | Owner | Cost | Effect | Code |
|---|---|---|---|---|---|
| **Move** | Universal | — | move budget | Step across lit tiles | `combat-actions.ts` |
| **Attack** | Universal | — | Act | Basic strike (flank-aware) | `combat-actions.ts` |
| **Defend** | Universal | — | Act | Self **Guarded** until next turn | `jobs.ts` `DEFEND` |
| **Rescue** | Universal | — | Act | Free an adjacent bound ally | `BattleScene.playerRescue` → `freeCaptive` |
| **Search** | **Stat** (Awareness) | — | Act | Wider/better trap-spot roll | `traps.ts` `revealTrapsNear` |
| **Disarm trap** | **Capability** (holds a trap skill) | Survivalist / Scout | Act | Disarm a spotted adjacent trap, pocket its kit | `traps.ts` `canDisarm` / `disarmTrap` |
| **Bribe** | **Class** (`hasNoble`) | Noble | Influence (rolled) | Sway an enemy → temp turncoat / permanent recruit | `economy-actions.ts` `bribeEnemy` |

### Class combat skills (`core/jobs.ts`)

The 2nd active unlocks at **job level 2** (D39). Cost beyond the Act is `charge`/`cooldown` (D37).

| Class | Skills |
|---|---|
| **Soldier** | Power Strike (heavy hit) · Hamstring (hit + Immobilize) · Second Wind (self-heal) |
| **Heavy Knight** | Cleave (90° arc) · Shove *(L2)* — passive **Tarpit** |
| **Hunter** | Reposition (kite) · Mark Prey *(L2, channel)* — passive **Deadeye** |
| **Scout** | Dash (reposition) · Expose *(L2, hit + Exposed)* — passive **solo-flank** |
| **Medic** | Heal (herb + rider, cooldown) · Mend *(L2, charged)* — passive **Triage** |
| **Snare-Trapper** *(enemy)* | Snare (ranged Immobilize) |

---

## Deployment actions (Deployment phase)

Pre-battle placement; verbs lower through the same interpreter as combat (D63).

| Verb | Gate | Owner | Effect | Code |
|---|---|---|---|---|
| **Set Trap** | **Class** | Survivalist | Place a 12-dmg trap | `jobs.ts` `SURVIVALIST` |
| **Set Snare** | **Class** | Scout | Place an 8-dmg trap that also **Immobilizes** (sets up Deadeye) | `jobs.ts` `SCOUT_JOB` |
| **Dig In** | Universal | — | Hunker for a lower capture chance | `combat-actions.ts` |
| **Deploy-move** | Universal | — | Reposition during deployment | `combat-actions.ts` |
| **Capture** *(enemy)* | — | — | The closing net binds an exposed unit | `combat-actions.ts` |

---

## Camp / Meta actions

The between-battle surface (`OverworldScene` Survey screen + the camp panel).

| Verb | Gate | Owner | Cost | Effect | Code |
|---|---|---|---|---|---|
| **Cook Stew** | **Class** | Chef | 1×/node | +1 morale, bank +8 HP/unit next battle | `jobs.ts` `CHEF` → `camp.ts` |
| **Rest** (in-place / node) | Universal | — | rations (gold) + RP | Small party heal (node = full recovery + fatigue wipe + debt clear) | `runloop.ts` `inPlaceRest`/`restNode` → `upkeep.ts` `restHeal` |
| **Triage** | **Capability** (Triage passive) | Medic | the healer's **fatigue** (worn out) | Heal the most-wounded for *more* than Rest, scaling with the wound | `overworld-actions.ts` `triage` / `isHealer` |
| **Skip an Upkeep line** | Universal | — | — | Cross a Food/Repairs line off the Ledger to free its gold — a deliberate gamble (hunger / worn-gear debt) | `OverworldScene.toggleSkip` → `camp.skippedUpkeep` |

> **Rest ≠ Triage** (a deliberate split): Rest is the *universal* RP/rations floor;
> Triage is the *healer's* push, paid in their own fatigue. Pure fatigue, no RP.

---

## Overworld actions

Between-node abilities on the cooldown spine (D29/D35), resolved by `takeOverworldAction`.
`jobIds` is an **enforced allowlist** (the actor's job must be on it).

| Verb | Gate | Owner | Cost | Effect | Code |
|---|---|---|---|---|---|
| **Survey** | **Class** (`jobIds:["scout"]`) | Scout | cooldown 2 + fatigue 1 | Raise a reachable node's intel preview by a tier | `overworld-actions.ts` `SURVEY` |

> *Naming note:* the **Survey** ability (id `survey`) is distinct from the **Scout
> class** (jobId `scout`) — the Scout performs the Survey. (Was a name collision.)

---

## Economy verbs (`core/economy-actions.ts`)

The three economy classes, each converting a different input (goods · time · standing),
all **purse-scoped** — never the guild treasury (D34).

| Verb | Gate | Owner | Cost | Effect |
|---|---|---|---|---|
| **Buy** (supply) | **Access** (market tier) | Merchant *(raises floor)* | gold (tier price) | +1 supply into storage |
| **Sell** (goods) | **Access** (market tier) | Merchant *(raises floor)* | self-limited (carried goods) | goods → purse gold |
| **Invest the Purse** | **Class** (`hasBanker`) | Banker | — | Engage flat purse interest per node-step |
| **Borrow** | **Class** (`hasBanker`) | Banker | debt | Advance gold now, auto-repaid from loot |
| **Guard the Purse** | **Class** (`hasBanker`) | Banker | gold (25) | Theft-protection skim reduction |
| **Patronize** | **Class** (`hasNoble`) | Noble | gold (12), 1×/node | +3 Influence (gold → standing) |
| **Influence (passive)** | **Class** (`hasNoble`) | Noble | — | +1 Influence per node-step (presence accrual) |
| **Bribe** | **Class** (`hasNoble`) | Noble | Influence (rolled) | *(see Combat — fired mid-battle)* |

---

## Event-node choices (`core/node-events.ts`)

At an **event node**, the player picks among the event's **choices** — situational,
**data-driven** decisions (new events are new records), not standing verbs. Gate is
**Universal / situational**: availability can be gated by standing (a patron event
needs Influence) or resources, but no *class* owns them. Resolved by `chooseEventOption`.

| Event | Choices (shape) |
|---|---|
| Wounded traveler | **help** (spend, maybe recruit) · **pass** |
| Abandoned shrine | **offer** (pay for a boon) · **loot** (take, risk) |
| Recruiter | **hire** (gold → roster) · **decline** |
| Shop | **buy** offered supplies · leave |
| Toll | **pay** · refuse |
| Patron's Welcome | accept the boon *(standing-gated)* |

> These reuse economy outcomes (hire, buy, pay) but as **one-off node options**, not
> the standalone Economy verbs above. The list is illustrative — the registry is the
> source of truth and grows.

## Guild / meta actions (the player's, not a class')

Guild-hall management (`game/scenes/GuildScene.ts`, `core/guild.ts`) — the guild-master
acts, no job gates.

| Verb | Effect |
|---|---|
| **Hire** | Recruit a mercenary from the pool into the roster |
| **Assign / Unassign** | Slot a roster member onto a caravan (capped by vessel capacity), or pull them off |
| **Lock / Unlock gear** | Commit armory gear to a caravan (locked out of the shared stock), or release it — gear is per-caravan, not per-member |
| **Dispatch** | Send an assembled caravan to a chosen board destination (starts a run) |
| **Rebuild** | Reset to a fresh starting guild |

---

## Open seams / candidates noted by the audit

- **Search** stays **Stat**-gated (Awareness) — anyone can spot, Disarm is the owned
  half. Defensible as-is; could be tightened to a recon class later.
- **Merchant Buy/Sell** stay **Access** (the documented Merchant model) rather than a
  hard class gate.
- `jobIds` allowlists are **expandable** — widening "who can Survey/…" is adding an id.
  Triage's **Capability** gate auto-extends to any future class with the Triage passive.
