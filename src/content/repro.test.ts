import { describe, it, expect, beforeEach } from "vitest";
import {
  createRunFromExpedition,
  RunLoop,
  THE_HOLLOW_MILL,
  dumpRun,
  restoreRun,
  serializeDump,
  parseDump,
  REPRO_DUMP_VERSION,
  clearInjectedNodes,
  type StatusInstance,
} from "../core";
import { injectContentNodes } from "./authored-nodes";

/**
 * **Moved from `core/` by the encounters-as-JSON migration (D122).** Every case here walks the
 * Hollow Mill to `snares`, and that walk now crosses `e1`, whose body lives in
 * `content/levels/e1-skirmish.json`. `runEncounter` throws on an `authoredId` it cannot resolve
 * rather than fabricating a fight, so the fixture only exists once the content catalog is
 * injected — and `core/` may never import `content/`. The file moved **wholesale** (D122's
 * "move the file, not the red test"): its two non-walking cases share the same arc fixture.
 * No assertion changed in the move.
 */
beforeEach(() => {
  clearInjectedNodes();
  injectContentNodes();
});

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
  run.camp.purse = 137; // an odd purse
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
    expect(restored.camp.purse).toBe(137);
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
    const goldAtCapture = dump.camp.purse;
    loop.run.camp.purse = 999; // mutate the live run after the capture
    loop.run.party[0].hp = 1;
    expect(dump.camp.purse).toBe(goldAtCapture); // the dump is unmoved
    expect(restoreRun(dump).camp.purse).toBe(goldAtCapture);
  });

  it("migrates a v1 dump (camp.gold) to the v2 purse field (D114)", () => {
    const run = createRunFromExpedition(THE_HOLLOW_MILL);
    run.camp.purse = 123;
    const v1 = JSON.parse(serializeDump(dumpRun(run))) as { v: number; camp: { purse?: number; gold?: number } };
    // Rewind the dump to the v1 wire shape: version 1, purse spelled `gold`.
    v1.v = 1;
    v1.camp.gold = v1.camp.purse;
    delete v1.camp.purse;
    const parsed = parseDump(JSON.stringify(v1));
    expect(parsed.v).toBe(REPRO_DUMP_VERSION);
    expect(restoreRun(parsed).camp.purse).toBe(123);
  });

  it("rejects a malformed or wrong-version paste loudly", () => {
    expect(() => parseDump("{not json")).toThrow(/not valid JSON/);
    expect(() => parseDump(JSON.stringify({ v: 999, map: {}, mapNodeId: "x", party: [] }))).toThrow(/version 999/);
    expect(() => parseDump(JSON.stringify({ v: REPRO_DUMP_VERSION }))).toThrow(/missing required fields/);
  });
});
