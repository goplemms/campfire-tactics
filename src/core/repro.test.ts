import { describe, it, expect } from "vitest";
import { createRunFromExpedition } from "./run";
import { RunLoop } from "./runloop";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { dumpRun, restoreRun, serializeDump, parseDump, REPRO_DUMP_VERSION } from "./repro";
import type { StatusInstance } from "./status";

/** Walk (playing rests/events) to a chosen-but-unplayed `snares` — a combat prep state. */
function loopAtSnares(): RunLoop {
  const loop = new RunLoop(createRunFromExpedition(THE_HOLLOW_MILL));
  let guard = 0;
  while (loop.run.mapNodeId !== "snares" && guard++ < 40) {
    const reachable = loop.reachable();
    if (reachable.length === 0) break;
    const next = reachable.find((n) => n.id === "snares") ?? reachable[0];
    loop.choose(next.id);
    if (next.id !== "snares") loop.playCurrentNode();
  }
  return loop;
}

/** Stamp interactive state onto a run that a route-replay would NOT reproduce. */
function scuffState(loop: RunLoop): void {
  const run = loop.run;
  run.camp.gold = 137; // an odd purse
  run.camp.morale = 6; // Inspired
  run.overworld.scouted["snares"] = 3; // surveyed to full tier
  const u = run.party[0];
  u.hp = Math.max(1, u.maxHp - 3);
  u.fatigue = 9;
  u.xp = 42;
  // A never-expiring status — the Infinity-duration serialization hazard.
  const forever: StatusInstance = { id: "warded", name: "Warded", duration: Infinity, kind: "buff" };
  u.statuses = [forever];
  u.counters = { capture: 2 };
}

describe("Repro Dump — full-fidelity capture + restore (debug tooling)", () => {
  it("round-trips a scuffed interactive state exactly (party / inventory / camp / econ)", () => {
    const loop = loopAtSnares();
    scuffState(loop);
    const run = loop.run;

    const restored = restoreRun(dumpRun(run));

    // Position + route.
    expect(restored.mapNodeId).toBe("snares");
    expect(restored.path).toEqual(run.path);
    expect(restored.night).toBe(run.night);
    expect(restored.difficultyId).toBe(run.difficultyId);
    expect(restored.expeditionId).toBe(run.expeditionId);
    // Camp + econ.
    expect(restored.camp.gold).toBe(137);
    expect(restored.camp.morale).toBe(6);
    expect(restored.overworld.scouted["snares"]).toBe(3);
    // Party (deep structural equality — a decoupled clone, not the same references).
    expect(restored.party).toEqual(run.party);
    expect(restored.party).not.toBe(run.party);
    const u = restored.party[0];
    expect(u.hp).toBe(run.party[0].hp);
    expect(u.fatigue).toBe(9);
    expect(u.xp).toBe(42);
    expect(u.counters.capture).toBe(2);
    // Inventory + flags + rescue quests.
    expect(restored.inventory).toEqual(run.inventory);
    expect(restored.flags).toEqual(run.flags);
    expect(restored.rescueQuests).toEqual(run.rescueQuests);
  });

  it("preserves an Infinity status duration through the JSON round-trip (the corruption hazard)", () => {
    const loop = loopAtSnares();
    scuffState(loop);
    const text = serializeDump(dumpRun(loop.run));
    // Plain JSON would have written `null` here; the sentinel keeps it Infinity.
    expect(text).not.toContain('"duration":null');
    const restored = restoreRun(parseDump(text));
    expect(restored.party[0].statuses[0].duration).toBe(Infinity);
  });

  it("restores the RNG cursor so subsequent draws continue identically", () => {
    const loop = loopAtSnares();
    scuffState(loop);
    const restored = restoreRun(dumpRun(loop.run));
    expect(restored.rng.state().s).toBe(loop.run.rng.state().s);
    // Both cursors, drawn forward, produce the same stream.
    const a = [loop.run.rng.int(1_000_000), loop.run.rng.int(1_000_000), loop.run.rng.int(1_000_000)];
    const b = [restored.rng.int(1_000_000), restored.rng.int(1_000_000), restored.rng.int(1_000_000)];
    expect(b).toEqual(a);
  });

  it("a restored run stages the pending encounter identically (determinism preserved)", () => {
    const original = loopAtSnares();
    scuffState(original);
    const restored = new RunLoop(restoreRun(dumpRun(original.run)));

    const oBattle = original.startEncounter();
    const rBattle = restored.startEncounter();
    expect(rBattle.units.length).toBe(oBattle.units.length);
    expect(rBattle.units.filter((u) => u.side === "enemy").length).toBe(oBattle.units.filter((u) => u.side === "enemy").length);
    // The staged field entities (the concealed snares) reproduce identically.
    expect(rBattle.entities.all().length).toBe(oBattle.entities.all().length);
  });

  it("the captured dump is decoupled — mutating the live run after capture can't change it", () => {
    const loop = loopAtSnares();
    scuffState(loop);
    const dump = dumpRun(loop.run);
    const goldAtCapture = dump.camp.gold;
    loop.run.camp.gold = 999; // mutate the live run after the capture
    loop.run.party[0].hp = 1;
    expect(dump.camp.gold).toBe(goldAtCapture); // the dump is unmoved
    expect(restoreRun(dump).camp.gold).toBe(goldAtCapture);
  });

  it("rejects a malformed or wrong-version paste loudly", () => {
    expect(() => parseDump("{not json")).toThrow(/not valid JSON/);
    expect(() => parseDump(JSON.stringify({ v: 999, map: {}, mapNodeId: "x", party: [] }))).toThrow(/version 999/);
    expect(() => parseDump(JSON.stringify({ v: REPRO_DUMP_VERSION }))).toThrow(/missing required fields/);
  });
});
