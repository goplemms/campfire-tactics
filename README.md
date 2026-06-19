# campfire-tactics

An **isometric roguelike tactics game** — in the lineage of *Fire Emblem* and
*Final Fantasy Tactics* — with a twist: the parts of the game that matter most
happen **around** the battles, not just on the grid.

## The hook: non-combat jobs

Alongside the usual combat classes, your party fills **non-combat jobs** that
reshape a run:

- **Chef** — raises party morale and provides between-battle healing.
- **Survivalist** — sets traps on the map *before* an encounter begins.
- **Merchant** — finds a market anywhere and trades goods for gold.

Each job deliberately acts in a *different* part of the game, which drives the
architecture below.

## Tech & platform strategy

Built **web-first** so it's fast to iterate and trivial to share:

- **TypeScript + Phaser 3 + Vite** for the game and rendering.
- **Vitest** for testing the pure game logic.

Web-first does **not** mean web-only. The plan keeps Steam and mobile open as
*additive wrappers*, not rewrites:

- **Desktop / Steam** → wrap the web build in **Tauri** (lightweight) or **Electron**.
- **Mobile (iOS/Android)** → wrap the same build with **Capacitor**.

The rule that makes this safe is a strict **core/render split**: a pure-logic
`core/` (no Phaser, no DOM — stats, grid, pathfinding, jobs, skills, turn rules,
run state) under a thin Phaser `game/` render layer. The core is headlessly
testable and travels unchanged into any platform shell.

## Architecture: a phase pipeline

Because the non-combat jobs act in different places, the game is modeled as
ordered phases, and jobs/skills are **data** that hook into a phase:

```
Meta (camp / party / economy)   →  Chef buffs, Merchant markets & trade
  → Deployment (pre-battle setup) →  Survivalist places traps
    → Battle (the iso grid)       →  combat jobs & skills
      → Resolution (rewards, loss) →  feeds back into Meta
```

The full system vision — each phase plus cross-cutting subsystems (the FFT-style
CT clock, field entities & trigger bus, logistics, stats), each with worked
examples — lives in [`docs/design/`](docs/design/).

## How this project is built (memento workflow)

This repo is also a live test of the [memento](https://github.com/goplemms/memento)
planning workflow. The flow:

1. **Workflow Init** — `scratchpad/` workspace + `.gitignore` (done).
2. **Discussion to Plan** — the design discussion became
   [`scratchpad/foundations/plan.md`](scratchpad/foundations/plan.md): a north-star
   goal, non-scope, and ordered milestones, each with a **user-testable gate**.
   Key architectural calls are recorded in
   [`scratchpad/foundations/decisions.md`](scratchpad/foundations/decisions.md).
3. **Orchestrate → Implement → Land** — build one milestone at a time; a milestone
   isn't done until its tests are green *and* its in-browser gate is met.

`scratchpad/foundations/PROGRESS.md` is the resume-from-anywhere status page.

> To drive the workflow locally, install the kit once with memento's
> `./install.sh --user`, then run `/orchestrate` from this repo.

## Status

Project **scaffolded**; no game code yet. Next milestone is **M1 — Walking
skeleton** (Vite + Phaser + TypeScript with the core/render split). See
[`plan.md`](scratchpad/foundations/plan.md).
