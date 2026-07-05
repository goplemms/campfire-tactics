import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import type { JobId } from "./jobs";
import { createRun, createRunFromExpedition } from "./run";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { simulateRun, batchSimulate, aggregate, formatDigest } from "./sim";
import { PILOT_POLICY, type BattlePolicy } from "./ai";

// The digest writes straight to stdout (vitest leaves this uncaptured). No
// @types/node in this project, so declare the narrow shape we use.
declare const process: { stdout: { write(s: string): void } };

/**
 * A fixed, representative starting party held **constant** across seeds — so only
 * the map + encounters vary, isolating "is the generated content beatable by this
 * roster?". A fresh set of unit objects each call (auto-play mutates them).
 */
function starterParty(): Unit[] {
  const mk = (id: string, jobId: JobId, o: Partial<Unit> = {}): Unit =>
    createUnit({
      id, name: id, side: "player", pos: { col: -1, row: -1 }, jobId,
      speed: 11, maxHp: 28, attack: 9, defense: 3, moveRange: 4, sightRadius: 5,
      awareness: 4, intelligence: 4, ...o,
    });
  return [
    mk("Rook", "soldier", { maxHp: 34, defense: 4 }),
    mk("Vale", "scout", { speed: 13, moveRange: 5, attack: 8 }),
    mk("Bram", "hunter", { attackRange: 2, attack: 10, maxHp: 24 }),
    mk("Wynn", "medic", { maxHp: 22, attack: 7 }),
  ];
}

const N = 80;
const proceduralMakers = Array.from({ length: N }, (_, i) => () => createRun(`sim-${i}`, { party: starterParty() }));

describe("run simulator (D55) — robustness net + difficulty floor", () => {
  const results = batchSimulate(proceduralMakers);
  const hollowMill = simulateRun(() => createRunFromExpedition(THE_HOLLOW_MILL));
  const digest = aggregate(results);

  it("every run reaches a terminal — no soft-lock / deadlock", () => {
    expect(results.filter((r) => !r.terminated).map((r) => r.seed)).toEqual([]);
    expect(hollowMill.terminated).toBe(true);
  });

  it("no run throws", () => {
    expect(results.filter((r) => r.status === "crash").map((r) => `${r.seed}: ${r.error}`)).toEqual([]);
    expect(hollowMill.error).toBeUndefined();
  });

  it("is deterministic — the same seed replays identically", () => {
    for (const seed of ["sim-3", "sim-17", "sim-42"]) {
      const a = simulateRun(() => createRun(seed, { party: starterParty() }));
      const b = simulateRun(() => createRun(seed, { party: starterParty() }));
      expect(b.status).toBe(a.status);
      expect(b.endNodeId).toBe(a.endNodeId);
      expect(b.summary).toEqual(a.summary);
    }
  });

  it("reports the Hollow Mill trap-engagement baseline (the Node-3 lever readout)", () => {
    // The naive bot's route always crosses the Sapper's Snares (L3, 5 traps) and —
    // picking first-reachable — the Secured Wagon (L6A, 3 more): 8 staged.
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
  });

  it("the policy seam is load-bearing through the sim — A/B lifts completion (D56)", () => {
    // A do-nothing enemy policy: if the seam is wired, the pilot player should win
    // far more runs than against the pilot enemy. Proves A/B works end to end.
    const passive: BattlePolicy = { name: "passive", plan: (u) => ({ unit: u, path: [], destination: u.pos, target: null }) };
    const makers = Array.from({ length: 12 }, (_, i) => () => createRun(`ab-${i}`, { party: starterParty() }));
    const vsPilot = aggregate(batchSimulate(makers));
    const vsPassive = aggregate(batchSimulate(makers, { policy: { player: PILOT_POLICY, enemy: passive } }));
    expect(vsPassive.completionRate).toBeGreaterThan(vsPilot.completionRate);
  });

  it("prints the digest + reports the difficulty floor (report-only, never fails CI)", () => {
    // Write straight to stdout (vitest doesn't intercept this) so `npm run sim`
    // always surfaces the digest without making the rest of the suite noisy.
    const t = hollowMill.summary.traps;
    const report =
      "\n" + formatDigest("procedural / normal", digest) +
      `\n  Hollow Mill (authored): ${hollowMill.status} — ended ${hollowMill.endNodeId} (L${hollowMill.endLayer})` +
      `\n  Hollow Mill traps: staged ${t.staged} · spotted ${t.spotted} · sprung ${t.sprung} · disarmed ${t.disarmed}`;
    // The naive bot is a conservative floor: it skips deploy, the economy and the
    // full kit. So a HIGH completion rate is the loud "too easy" smell; a 0% rate is
    // expected-ish but worth a glance for a wall. Report only — balance is still moving.
    const flag =
      digest.completionRate > 0.6
        ? `\n  ⚠ naive-bot completion ${(digest.completionRate * 100).toFixed(0)}% — content may be too easy.`
        : digest.completionRate === 0
          ? "\n  ⚠ naive bot never completes a run — expected for a floor, but check the end-layer histogram for a wall."
          : "";
    process.stdout.write(report + flag + "\n\n");
    expect(digest.completionRate).toBeGreaterThanOrEqual(0);
    expect(digest.completionRate).toBeLessThanOrEqual(1);
  });
});
