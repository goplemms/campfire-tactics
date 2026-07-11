# 08b · Combat processing stack

How a combat frame is actually *built and processed*, top to bottom. This is a
**containment / dependency** view, not a flow: each layer **sits on** the one below and
may only depend downward. The headline invariant — **`core/` never imports Phaser or the
DOM** — is what keeps the bottom two layers headlessly testable and portable into any
platform shell (Tauri, Capacitor, …).

```mermaid
flowchart TB
  subgraph UI["① UI / SCENE — Phaser · input · orchestration"]
    BS["BattleScene.ts<br/>reads input, owns the scene, wires the frame together"]
  end

  subgraph VIEW["② VIEW — presentation only · reads core state, never mutates it"]
    CV["CombatView (combat-view.ts)<br/>draws the board · status pips · target highlights"]
  end

  subgraph LOGIC["③ LOGICAL CORE — the rules · headless · no Phaser, no DOM"]
    BF["battle-flow · clock · combat · combat-actions · resolution"]
  end

  subgraph ATOM["④ ATOMIC PRIMITIVES — geometry & math everything sits on"]
    PRIM["iso · grid · pathfinding · rng · num"]
  end

  BS -->|"drives + renders via"| CV
  BS -->|"issues commands to"| BF
  CV -->|"reads state from"| BF
  BF -->|"built on"| PRIM
  CV -.->|"projects tiles via (gridToScreen)"| PRIM

  %% ── the invariant that makes the split real ──
  BARRIER["⛔ the core boundary — src/core/index.ts<br/>① ② live in game/ (render) · ③ ④ live in core/ (pure logic)"]
  VIEW -.-> BARRIER
  LOGIC -.-> BARRIER

  classDef ui fill:#E2E8F0,color:#0F172A,stroke:#475569,stroke-width:1px
  classDef view fill:#BFDBFE,color:#0F172A,stroke:#1D4ED8,stroke-width:1px
  classDef logic fill:#BBF7D0,color:#052E16,stroke:#15803D,stroke-width:1px
  classDef atom fill:#E2E8F0,color:#0F172A,stroke:#64748B,stroke-width:1px
  classDef barrier fill:#FEE2E2,color:#7F1D1D,stroke:#B91C1C,stroke-width:1px,stroke-dasharray:4 3

  class BS ui
  class CV view
  class BF logic
  class PRIM atom
  class BARRIER barrier

  style UI fill:#F1F5F9,stroke:#475569
  style VIEW fill:#EFF6FF,stroke:#1D4ED8
  style LOGIC fill:#F0FDF4,stroke:#15803D
  style ATOM fill:#F8FAFC,stroke:#64748B
```

## Reading the stack

- **Dependencies point down only.** `BattleScene` may reach the View and the rules; the
  View may read core state but **never mutates** it (all mutation goes through the rules in
  ③); the rules stand on the primitives in ④. Nothing below ever imports anything above.
- **Two responsibilities cross the boundary.** The Scene **issues commands** downward
  (a player clicks → call a rule in `battle-flow`) and the View **reads state** upward-out
  (the rule returns new `Battle` state → the View redraws). Input goes down; state comes back.
- **The barrier is enforced, not aspirational.** The core barrel
  [`src/core/index.ts`](../../../src/core/index.ts) is the seam: `game/` imports *from* it,
  and its header forbids core from reaching into Phaser or the DOM. That single rule is why
  ③ + ④ are unit-tested headlessly and travel unchanged into a desktop/mobile wrapper.

> This is one of **three** combat-layer views. `08a` draws the same `core/` ↔ `game/` split
> at the whole-app scale; `08c` draws the *gameplay* layers (CT clock → actions → field
> entities → statuses → vision). Maps to: [Design Overview → Tech & platform strategy](../../../README.md).
