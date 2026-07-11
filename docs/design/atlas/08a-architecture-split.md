# 08a · Architecture split (whole app)

The load-bearing structural rule of the whole codebase — the same `core/` ↔ `game/` split that
[`08b`](08b-processing-stack.md) draws for one combat frame, here at **app scale**. A pure-logic
`core/` (no Phaser, no DOM) sits under a thin Phaser `game/` render layer. The core is headlessly
testable and travels unchanged into any platform shell.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'17px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':40,'rankSpacing':60,'padding':16}}}%%
flowchart TB
  subgraph GAME["game/ — RENDER · Phaser + DOM"]
    SCENES["Scenes — OverworldScene · GuildScene · BattleScene"]
    VIEWS["Views &amp; UI — combat-view · market-view · dossier · ledger-sheet · …"]
  end

  SEAM["🔒 the seam — src/core/index.ts (the barrel)<br/>game/ imports FROM core · core imports NO Phaser, NO DOM"]:::seam

  subgraph CORE["core/ — PURE LOGIC · headless · Vitest-tested"]
    RUNLOOP["run frame — run · overworld · guild · economy · ledger"]
    FIGHT["combat — clock · combat · entities · deployment · resolution"]
    CHAR["character — jobs · skills · leveling · units · status"]
    PRIM["primitives — iso · grid · pathfinding · rng · num"]
  end

  SHELL["platform shell — Tauri / Electron / Capacitor<br/>wraps the same web build, no rewrite"]:::shell

  SCENES --> VIEWS
  GAME ==> SEAM
  SEAM ==> CORE
  RUNLOOP --> PRIM
  FIGHT --> PRIM
  CHAR --> PRIM
  CORE -.->|"travels unchanged into"| SHELL

  classDef seam fill:#DC2626,color:#ffffff,stroke:#7F1D1D,stroke-width:3px,stroke-dasharray:5 3
  classDef shell fill:#F1F5F9,color:#334155,stroke:#64748B,stroke-width:2px,stroke-dasharray:4 3

  style GAME fill:#64748B,color:#ffffff,stroke:#334155,stroke-width:4px
  style CORE fill:#16A34A,color:#ffffff,stroke:#166534,stroke-width:4px
  style SCENES fill:#F1F5F9,color:#0f172a,stroke:#475569,stroke-width:2px
  style VIEWS fill:#F1F5F9,color:#0f172a,stroke:#475569,stroke-width:2px
  style RUNLOOP fill:#ffffff,color:#065F46,stroke:#16A34A,stroke-width:2px
  style FIGHT fill:#ffffff,color:#065F46,stroke:#16A34A,stroke-width:2px
  style CHAR fill:#ffffff,color:#065F46,stroke:#16A34A,stroke-width:2px
  style PRIM fill:#ffffff,color:#065F46,stroke:#16A34A,stroke-width:2px
```

## Reading it

- **One rule makes it all work:** `core/` never imports Phaser or the DOM. The barrel
  [`src/core/index.ts`](../../../src/core/index.ts) is the single seam `game/` imports from.
  Everything below it is plain data + functions.
- **Why it's worth the discipline.** Because the core is pure, the entire run frame — stats, grid,
  pathfinding, jobs, skills, turn rules, run state — is **unit-tested headlessly** (Vitest, plus the
  `sim` / feasibility harnesses) with no browser, and the same build **wraps into desktop or mobile
  without a rewrite** (web-first, not web-only).
- **`game/` is deliberately thin.** Scenes own input and orchestration; views own drawing. They read
  core state and issue commands to it — they don't hold rules. (The per-frame version of this is
  [`08b`](08b-processing-stack.md).)

> Maps to: [Design Overview → Tech & platform strategy](../../../README.md) and the
> [`src/core/index.ts`](../../../src/core/index.ts) barrel header.
