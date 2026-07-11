# The Systems Atlas

A set of **small, focused diagrams** — one per system — that together map the
whole shape of the game. The design docs describe each system well in prose; this
atlas exists to answer the question prose can't: *how does it all fit together, and
what nests inside what?*

> **Source of truth vs. map.** These diagrams are a **map**, not the territory. When
> a diagram and a system doc (or [`decisions.md`](../../../scratchpad/foundations/decisions.md))
> disagree, the doc wins — open an issue or fix the diagram. The atlas is meant to be
> cheap to keep honest precisely *because* it's Mermaid text, not a binary image.

## How to read it

Every diagram shares **one color language for the scales**, so a Combat box looks the
same whether you see it in the master map or a detail view:

| Color | Scale | What it is |
|---|---|---|
| 🟣 Purple | **Guild** | The persistent home — survives every run |
| 🔵 Blue | **Run / Overworld** | One caravan's start → final playthrough |
| 🟢 Teal | **Node** | One night — a single stop on the run map |
| 🟠 Amber | **Mission phases** | The Meta → Deployment → Combat → Resolution pipeline |
| 🔴 Red | **Combat** | The isometric battle on the CT clock |

Diagrams come in three shapes, matched to their content:

- **Containment** (what nests in what) — the master map, the guild, combat architecture.
- **Taxonomy** (kinds & trees) — node kinds, jobs & prestige.
- **Sequence / flow** (order over time) — the phase pipelines, the CT clock, the node lifecycle.

## Contents

Legend: ✅ drafted · ⬜ planned

### Master
- ✅ [`00 · The nesting`](00-nesting.md) — the "you-are-here" containment map that sets the colors.

### Structure
- ⬜ `01 · Guild / home tier` — Roster · Treasury · Armory · Quest Board · Stable of Caravans → Dispatch.
- ⬜ `02 · Overworld` — the layered node DAG; Intel reveals, Fog hides; start → final.
- ⬜ `03 · Node kinds` — `combat | rest | event` + the event sub-types.
- ⬜ `04 · Jobs & prestige` — combat vs. support jobs, prestige chains, roster tiers, breadth × depth.

### Sequences
- ⬜ `05 · Node / travel lifecycle` — Prep Camp → Begin → Encounter → React Camp → Set Out.
- ⬜ `06 · Mission phase pipeline` — Meta → Deployment → Combat → Resolution → loop.
- ⬜ `07 · Combat turn order` — the CT clock: Advance Clock vs. End Turn; Move + Act; Instant vs. Charged.

### Combat layers
- ⬜ `08a · Architecture split` — pure `core/` under the Phaser `game/` layer.
- ✅ [`08b · Processing stack`](08b-processing-stack.md) — Scene → View → logical core → atomic primitives.
- ⬜ `08c · Gameplay layers` — CT clock → actions → field entities / trigger bus → statuses → vision / telegraph.

### Cross-cutting
- ⬜ `09 · Jobs × Phases` — which job's signature act fires in which phase.

## Adding a diagram

The atlas is **deliberately extensible** — new systems get new pages, they don't cram
into existing ones. To add one:

1. Create `NN-short-name.md` in this folder.
2. Reuse the scale colors above (copy a `classDef` block from an existing diagram).
3. Keep it **one shape per diagram** — don't mix a taxonomy and a flow on one canvas;
   split instead.
4. Link back to the system doc it maps, and add a row to **Contents** above.
