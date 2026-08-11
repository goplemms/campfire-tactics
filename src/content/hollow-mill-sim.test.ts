import { describe, it, expect } from "vitest";
import { createRunFromExpedition, simulateRun, THE_HOLLOW_MILL } from "../core";
import { injectContentNodes } from "./authored-nodes";

// The digest writes straight to stdout (vitest leaves this uncaptured). No
// @types/node in this project, so declare the narrow shape we use.
declare const process: { stdout: { write(s: string): void } };

/**
 * The **authored-arc half of the run simulator** (D55), moved here by the encounters-as-JSON
 * migration (D122).
 *
 * The Hollow Mill's node bodies are migrating from TS consts to `content/levels/*.json`. A JSON
 * body reaches core only through the **injection seam** (`injectContentNodes()` → the shared
 * authored-node catalog), and `core/` may never import `content/` — so the moment the first body
 * converted, `core/sim.test.ts` could no longer simulate the arc: `runEncounter` fails loud with
 * *"binds authoredId … but no body resolved … an un-injected content catalog"*. That is the guard
 * working, not a defect.
 *
 * So the arc run lives here, one layer up, with the real content injected — the same shape as
 * `the-rescue-expedition.test.ts` (D116). `npm run sim` runs this file **and** `core/sim.test.ts`;
 * the procedural robustness net stays in core, where it needs no content at all. Every assertion
 * and every printed line below is verbatim from `core/sim.test.ts` — the digest is unchanged.
 */
injectContentNodes(); // before `simulateRun` runs at describe-body evaluation time

describe("run simulator (D55) — the authored Hollow Mill arc", () => {
  const hollowMill = simulateRun(() => createRunFromExpedition(THE_HOLLOW_MILL));

  it("reaches a terminal without throwing — no soft-lock, no dangling authored body", () => {
    expect(hollowMill.terminated).toBe(true);
    // Also the migration's live proof: an un-injected (or unconverted-and-deleted) body
    // surfaces here as a fail-loud error string, not as a silently different run.
    expect(hollowMill.error).toBeUndefined();
  });

  it("reports the Hollow Mill trap-engagement baseline (the Node-3 lever readout)", () => {
    // The naive bot's route crosses the Sapper's Snares (L3, 5 traps) and — picking
    // first-reachable, the infiltration arm — the Outer Yard's mined approach (3 more): 8 staged.
    expect(hollowMill.summary.traps.staged).toBe(8);
    // The BASELINE TRUTH this pin makes loud: headless play can only *blunder into*
    // traps. The Awareness spot loop and the disarm verb live in the render layer
    // (BattleScene), so the sim's floor is spotted 0 / disarmed 0 — the trap lever
    // registers as silent damage only. When the spot/avoid/disarm layer reaches the
    // core (or the Node-3 pass changes the field's shape), these move — repin then.
    expect(hollowMill.summary.traps.spotted).toBe(0);
    expect(hollowMill.summary.traps.disarmed).toBe(0);
    // The charging bot eats mid-field snares on the way across (path-dependent, so
    // pinned loosely): the field is *felt* headlessly, just never *read*.
    expect(hollowMill.summary.traps.sprung).toBeGreaterThan(0);
    expect(hollowMill.summary.engaged.feltTraps).toBe(true);
    // The D82 sweep gate BITES in the canonical bot run: Vale (the only trap-trained
    // member) is DOWN at each trap-field win — she blunders into her own lesson — so
    // no snares sweep. Not dead code: protect the sweeper and this number moves.
    expect(hollowMill.summary.traps.salvaged).toBe(0);
  });

  it("prints the arc's digest lines (report-only, never fails CI)", () => {
    const t = hollowMill.summary.traps;
    process.stdout.write(
      `\n  Hollow Mill (authored): ${hollowMill.status} — ended ${hollowMill.endNodeId} (L${hollowMill.endLayer})` +
      `\n  Hollow Mill traps: staged ${t.staged} · spotted ${t.spotted} · sprung ${t.sprung} · disarmed ${t.disarmed} · salvaged ${t.salvaged}\n\n`,
    );
    expect(hollowMill.status).toBe("complete");
    expect(hollowMill.endNodeId).toBe("finale");
  });
});
