# System — The verb substrate (the Verb Cell: one grammar, one projection)

> Referenced by: [Design Overview](../README.md), [Action catalogue](actions.md)
> (the player-facing verb glossary this substrate powers). Siblings:
> [Action economy / CT clock](action-economy.md) (D5, combat pacing),
> [Combat actions](combat-actions.md) (the command/replay/undo shape),
> [Purse journal](purse-journal.md) (the provenance seam).
> Decisions: **D89** (this record — the cell named), realizing **D72** (the one home)
> and extending **D61/D88** (paced-or-priced), **D87** (determinism), **D56/D57** (the
> legal-move projection), **D5/D37** (the charge clock).
>
> Status: **built** (refactor R4, three batch PRs — grammar → migration → projection).
> Implementation: `src/core/cost.ts`, `src/core/overworld-actions.ts`,
> `src/core/economy-actions.ts`, `src/core/skills.ts`, `src/core/jobs.ts`,
> `src/core/jobs-data/*.ts`, `src/core/clock.ts`, `src/core/turn.ts`,
> `src/game/scenes/OverworldScene.ts`.

## What this is

Every **verb** in the game — a combat skill, a between-nodes camp action, an economy
trade — is the **same cell** of moving parts, applied at two tiers (the CT clock in
battle, the node-step clock at camp). "The Verb Cell" is the name for that repeated
shape. A new verb is a **new record**, never a new branch (the D4/D72 ethos): you
declare data, and the existing interpreter/gate/projection carry it.

This is the payoff of R4: the camp UI stopped hand-wiring a button per verb, the
economy verbs stopped being standalone functions with a parallel cost registry, costs
collapsed to one grammar, and the vestigial `SkillDef.phase` axis retired. Queued
content (Banker, the triad kits, prestige forks) now lands as records.

## The cell — seven parts

| Part | What it is | Where |
| --- | --- | --- |
| **Registry** | The verb is a `SkillDef` living on a `JobDef.skills` (its **class home**) or in a **universal home** (`UNIVERSAL_SKILLS` for combat, `UNIVERSAL_OVERWORLD_SKILLS` for camp). No verb floats free. | `skills.ts`, `jobs.ts`, `jobs-data/*` |
| **Gate** | The layered availability check: the **class** home (living on the job) + an optional **capability** (`SkillDef.requires`, e.g. `healer`) + the **cost** gate (paced-or-priced, D61/D88). For overworld verbs the cost gate is `checkOverworldCost`, a closure `{ ok, prices, commit() }` that captures prices at check time. | `leveling.availableSkills`, `overworld-cost.ts` |
| **Interpreter** | The single resolver every verb of a tier routes through — `Battle.useSkill` (combat) / `useOverworldSkill` (camp). It applies the gate, dispatches the effect, then commits the spend + grants use-XP. One path, no per-verb branches. | `turn.ts`, `overworld-actions.ts` |
| **Effect registry** | The exhaustive, compile-time-checked mapped type per effect union: `BATTLE_EFFECT_HANDLERS`, `OVERWORLD_EFFECT_HANDLERS`, `FORECAST_HANDLERS`, `GRANT_EFFECT_HANDLERS`. Adding an effect kind fails the build until its handler exists. Each economy verb's handler delegates to a shared **effect core** (`applyXEffect`). | `skills.ts`, `overworld-actions.ts` |
| **Outcome** | One canonical result shape: `ActionOutcome` (`applied` + `reason`/`detail`), extended per tier (`OverworldActionResult`, `CampSkillResult`, `SkillOutcome`). The render reads it; it never throws on a refusal. | `overworld-actions.ts`, `skills.ts` |
| **Projections** | Pure reads over the registry + gate: **`availableSkills(unit, context)`** (combat) and **`availableActions(run)` → `ActionView[]`** (camp — verdict + resolved cost readout per usable verb). The camp UI and the sim meta-policy's legal-move enumeration both render the projection; nothing is hand-wired. | `leveling.ts`, `overworld-actions.ts` |
| **Labeled RNG** | Any randomness a verb rolls draws from `streamFor(seed, Labels.x(...))` — every label registered in `rng-labels.ts`, grep-guarded, values pinned. Deterministic, replayable (D22/D87). | `rng.ts`, `rng-labels.ts` |
| **Provenance log** | Spends flow through the chokepoints — the purse journal (`earn`/`spend`), `accrueRp`/`spendRp`, `nudgeMorale` — and combat verbs append to the serializable action log (replay/undo). No verb mutates a resource off-book. | `purse-journal.ts`, `upkeep.ts`, `combat-actions.ts` |

### The one cost grammar (#113)

A verb's cost is **one type** with a **clock-domain tag**: pacing denominated in the
surface's clock (combat CT via `charge`/`cooldown`; camp node-steps via
`cooldown`/`usesPerNode`) and a **price map** of per-cast resources —
`fatigue`/`gold`/`influence`/`rp` and **materials** (`{ id?, count }`). A price may be
a **provider** (a `run → number` closure) for a dynamic cost (Cook Stew priced at the
night's food value), resolved once at check time. Consumables are consumed in the
**commit half**, so undo/telegraph read them as data (the old `stash` special case is
gone). The **invariant** (D61/D88): every verb is paced *or* priced — "free and
unlimited" is unrepresentable, enforced by a load-time walk over both homes and a guard
test that classifies every exported verb by name.

## Instances (the cell, filled in)

- **Combat skills** — attack/cleave/forced-move/heal/med-heal/status/channel/guard-allies/
  triage-heal. Home: the four kits + universals (Defend, Dig In). Charged skills
  (`cost.charge`) commit to the CT clock and resolve later; `targetMode: "tile" | "unit"`
  (#149) decides re-acquisition — homing (the friendly Mend) vs a ground shot that whiffs
  if the target leaves the captured tile (the `clock.ts` target-moved fizzle).
- **Overworld / camp verbs** — Survey (Scout), Cook Stew / Feast (Cook), Find Trade /
  Savvy Barter (Merchant), Forage (Survivalist). Effect kinds
  `survey`/`provisionMeal`/`morale`/`openMarket`/`primeDeal`/`forage`.
- **Economy verbs** — Merchant Sell, Banker Invest/Borrow/Guard, Noble Patronize (class
  homes); **Buy** and the **Triage fallback** (universal homes — anyone can shop where
  there's a market; a Medic-less party heals at half efficiency). Effect kinds
  `sell`/`borrow`/`engageInterest`/`guardPurse`/`patronize`/`buy`/`triage`. `bribeEnemy`
  rides the gate's `influence` knob with a per-target computed price.
- **Per-step faucets** (`JobFaucet`, #114) — the passive twin of a verb: the Noble's
  Renown (`influencePerStep`) and the Thief's Deft Hands (`goldSkim: { chance, amount,
  nodeKinds? }`), resolved by the one `accrueDeclaredFaucets` walk at `breakCamp`.

## Recipe — authoring a new verb

1. **Pick the home.** On a `JobDef.skills` for a class verb, or a universal home
   (`UNIVERSAL_SKILLS` / `UNIVERSAL_OVERWORLD_SKILLS`) for a verb everyone gets. Add a
   `requires: <CapabilityId>` if it's capability-gated (like the Medic's full Triage).
2. **Declare the cost.** Set `cost` (combat: `charge`/`cooldown`/`material`) or
   `overworldCost` (camp: `cooldown`/`usesPerNode` + `fatigue`/`gold`/`influence`/`rp`/
   `material`, static or a provider closure). It must be **paced or priced** — the
   load-time walk will reject a free-and-unlimited cost.
3. **Choose the effect kind.** Reuse an existing `SkillEffect`/`OverworldActionEffect`
   kind if one fits. If you need a **new** kind, add it to the union and the mapped-type
   registry (`OVERWORLD_EFFECT_HANDLERS` / `BATTLE_EFFECT_HANDLERS`) — the build fails
   until the handler (and any `FORECAST_HANDLERS` entry) exists. Put the post-gate
   mutation in an **effect core** if a legacy wrapper shares it.
4. **Label any RNG.** Add a `Labels.x(...)` entry in `rng-labels.ts` and draw via
   `streamFor` — never `Math.random`.
5. **Route spends through the chokepoints** (`earn`/`spend`, `accrueRp`/`spendRp`,
   `nudgeMorale`); combat verbs are logged for replay/undo automatically by the
   interpreter.
6. **Surface nothing by hand.** The verb appears in `availableSkills` /
   `availableActions` automatically; the combat HUD and the camp drawers render the
   projection. A new camp verb of an existing effect-kind category needs no scene edit.
7. **Pin it.** Add the availability/gate test; if it's an economy verb, the export-guard
   classifies it (a new ungated verb fails by name).

## Not in the cell (deliberately)

- **The interactive thief steal/flee** lives in `BattleScene` (game layer); the pure
  combat layer is purse-agnostic, so the headless sim doesn't model theft. The
  `steal-then-flee` standing order (#153) was left unshipped for that reason (D89) —
  standing orders are the *behavior* cell (D84), a sibling to the verb cell, not part of
  it.
- **Player flow controls** (Undo, Advance Clock, panel navigation) carry no game
  decision and are not verbs — see [Action catalogue](actions.md) scope.
