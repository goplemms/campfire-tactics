# campfire-tactics

An **isometric roguelike tactics game** — in the lineage of *Fire Emblem* and
*Final Fantasy Tactics* — with a twist: the parts of the game that matter most
happen **around** the battles, not just on the grid.

## The hook: it's an expedition

You're responsible for getting a fragile band through a dangerous journey, and the
game's character is **preparation under uncertainty**. The unifying verb across
every system is *commit scarce resources against uncertainty before the fight, then
live with it* — **combat is the test of your preparation, not the game itself.**
Preparation runs on three axes (material **logistics**, **spatial** deployment,
**informational** intel/vision), bound by a human-stakes layer (morale, mortality,
the named cast).

One vivid expression of that identity: alongside the usual combat classes, your
party fills **non-combat jobs**, each acting in a *different* part of the game —
which is what drives the phase architecture below:

- **Chef** — raises party morale and provides between-battle healing.
- **Survivalist** — sets traps on the map *before* an encounter begins.
- **Merchant** — increases storage size and generates gold.

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
Meta (camp / party / economy)   →  Chef buffs, Merchant gold & storage
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

Milestones **M1–M12 are landed** — the full phase pipeline, the seeded branching
**overworld**, the persistent **guild/caravan** tier, the two-pool **economy** +
recruitment, data-driven **event nodes**, and a four-class **combat slice** proven
end-to-end by a playable demo quest (*The Hollow Mill*). Notable design-only
holdouts: **Vancian magic** (a typed stub, not wired) and **full line-of-sight**
vision (radius only so far). See
[`scratchpad/foundations/PROGRESS.md`](scratchpad/foundations/PROGRESS.md) for the
authoritative milestone-by-milestone status and [`plan.md`](scratchpad/foundations/plan.md)
for the roadmap.
