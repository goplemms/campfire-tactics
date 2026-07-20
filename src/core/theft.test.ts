import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createRun, reachableNodes, type RunState } from "./run";
import { RunLoop } from "./runloop";
import {
  rollSkim,
  thiefSteal,
  thiefEventSkim,
  recoverStolen,
  thiefEscapes,
} from "./theft";
import { ENEMY_TEMPLATES } from "./generation";
import { generateOverworld, getNode } from "./overworld";
import { eventForNode } from "./node-events";

let nextId = 0;
function fighter(name: string): Unit {
  return createUnit({
    id: `${name}-${nextId++}`,
    side: "player",
    pos: { col: -1, row: -1 },
    name,
    jobId: "soldier",
    speed: 11,
    maxHp: 28,
    attack: 9,
    defense: 3,
    moveRange: 4,
    sightRadius: 5,
    awareness: 3,
    intelligence: 3,
  });
}

function newRun(seed: string, gold = 100): RunState {
  return createRun(seed, { party: [fighter("Rook")], difficultyId: "normal", gold });
}

describe("theft — the thief archetype is data (D30)", () => {
  it("ENEMY_TEMPLATES carries a flagged thief", () => {
    const thief = ENEMY_TEMPLATES.find((t) => t.thief);
    expect(thief).toBeDefined();
    expect(thief!.id).toBe("thief");
  });
});

describe("theft — a thief skims the purse (D30)", () => {
  it("thiefSteal lifts gold off the purse", () => {
    const run = newRun("steal", 100);
    const attempt = thiefSteal(run, "thief:e1");
    expect(attempt.stolen).toBeGreaterThan(0);
    expect(run.camp.purse).toBe(100 - attempt.stolen);
    expect(attempt.purseAfter).toBe(run.camp.purse);
    expect(attempt.resolved).toBe(false);
  });

  it("a skim never exceeds the purse", () => {
    const run = newRun("steal-small", 3);
    const attempt = thiefSteal(run, "thief:e1");
    expect(attempt.stolen).toBeLessThanOrEqual(3);
    expect(run.camp.purse).toBeGreaterThanOrEqual(0);
  });
});

describe("theft — kill-to-recover vs. escapes-off-map (D13/D21)", () => {
  it("killed before escape → the stolen gold drops back into the purse", () => {
    const run = newRun("recover", 100);
    const attempt = thiefSteal(run, "thief:e1");
    const purseAfterSkim = run.camp.purse;
    const recovered = recoverStolen(run, attempt);
    expect(recovered).toBe(attempt.stolen);
    expect(run.camp.purse).toBe(purseAfterSkim + attempt.stolen);
    expect(run.camp.purse).toBe(100); // whole again
    expect(attempt.resolved).toBe(true);
    // Recovery is idempotent once resolved.
    expect(recoverStolen(run, attempt)).toBe(0);
  });

  it("escaped off-map → the gold stays lost (the purse is not credited back)", () => {
    const run = newRun("escape", 100);
    const attempt = thiefSteal(run, "thief:e1");
    const purseAfterSkim = run.camp.purse;
    const lost = thiefEscapes(attempt);
    expect(lost).toBe(attempt.stolen);
    expect(run.camp.purse).toBe(purseAfterSkim); // unchanged — gone for good
    expect(attempt.resolved).toBe(true);
  });
});

describe("theft — the Banker's protection blunts the skim (D30)", () => {
  it("rollSkim with protection lifts strictly less than without", () => {
    const unprotected = rollSkim("seedX", "thief:e1", 200, 0);
    const protectedSkim = rollSkim("seedX", "thief:e1", 200, 0.5);
    expect(unprotected).toBeGreaterThan(0);
    expect(protectedSkim).toBeLessThan(unprotected);
  });

  it("thiefSteal honours engaged protection from the run economy", () => {
    const a = newRun("protect-cmp", 200);
    const b = newRun("protect-cmp", 200);
    b.overworld.protection = 0.5;
    const stolenA = thiefSteal(a, "thief:e1").stolen;
    const stolenB = thiefSteal(b, "thief:e1").stolen;
    expect(stolenB).toBeLessThan(stolenA);
  });

  it("a skim is deterministic for a seed + label", () => {
    expect(rollSkim("s", "thief:n2-1", 150, 0)).toBe(rollSkim("s", "thief:n2-1", 150, 0));
  });
});

describe("theft — the thief EVENT node skims on the overworld (D30)", () => {
  it("thiefEventSkim lifts gold off the purse, keyed by the node", () => {
    const run = newRun("event", 120);
    const node = getNode(run.map, run.map.order[1]);
    const attempt = thiefEventSkim(run, node);
    expect(attempt.stolen).toBeGreaterThan(0);
    expect(run.camp.purse).toBe(120 - attempt.stolen);
    // Same node + seed reproduces the same skim.
    const run2 = newRun("event", 120);
    const node2 = getNode(run2.map, run2.map.order[1]);
    expect(thiefEventSkim(run2, node2).stolen).toBe(attempt.stolen);
  });

  it("the runloop plays a thief event node as a purse skim (M11 registry regression)", () => {
    // Find a seed whose map has an event node that the M11 registry resolves to the
    // **thief** event, then play it via the runloop and assert the skim.
    let seed = "";
    let eventId = "";
    for (let i = 0; i < 80; i++) {
      const s = `evt-${i}`;
      const map = generateOverworld(s);
      const ev = map.order
        .map((id) => getNode(map, id))
        .find((n) => n.kind === "event" && eventForNode(s, n).kind === "thief");
      if (ev) {
        seed = s;
        eventId = ev.id;
        break;
      }
    }
    expect(seed).not.toBe("");

    const run = createRun(seed, { party: [fighter("Rook")], difficultyId: "normal", gold: 100 });
    const loop = new RunLoop(run);
    // Walk forward (pick-first) until positioned on the thief event node.
    let guard = 0;
    while (run.mapNodeId !== eventId && guard++ < 20) {
      const next = reachableNodes(run);
      const toward = next.find((n) => n.id === eventId) ?? next[0];
      if (!toward) break;
      loop.choose(toward.id);
      if (run.mapNodeId === eventId) break;
      loop.playCurrentNode();
    }
    if (run.mapNodeId === eventId) {
      const purseBefore = run.camp.purse;
      const res = loop.eventNode();
      expect(res.def.kind).toBe("thief");
      expect(res.outcome.stolen).toBeGreaterThanOrEqual(0);
      expect(run.camp.purse).toBe(purseBefore - (res.outcome.stolen ?? 0));
    }
  });
});
