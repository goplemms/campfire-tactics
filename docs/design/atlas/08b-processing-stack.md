# 08b · Combat processing stack

How a combat frame is actually *built and processed*, top to bottom. This is a
**containment / dependency** view, not a flow: each layer **sits on** the one below and
may only depend downward. The headline invariant — **`core/` never imports Phaser or the
DOM** — is what keeps the bottom two layers headlessly testable and portable into any
platform shell (Tauri, Capacitor, …).

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'18px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':50,'rankSpacing':70,'padding':16}}}%%
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

  %% white content boxes; solid shelves carry the layer colour
  classDef leaf fill:#ffffff,color:#0f172a,stroke:#334155,stroke-width:2px
  class BS,CV,BF,PRIM leaf

  style UI fill:#64748B,color:#ffffff,stroke:#334155,stroke-width:4px
  style VIEW fill:#2563EB,color:#ffffff,stroke:#1E3A8A,stroke-width:4px
  style LOGIC fill:#16A34A,color:#ffffff,stroke:#166534,stroke-width:4px
  style ATOM fill:#475569,color:#ffffff,stroke:#1E293B,stroke-width:4px
  style BARRIER fill:#DC2626,color:#ffffff,stroke:#7F1D1D,stroke-width:3px
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
