import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createCamp, type Camp } from "./camp";
import { DYING_COUNTER, type RescueQuest } from "./mortality";
import { captainsJournal, hasConcerns, GEAR_WEAR_WARN } from "./journal";
import type { RunState } from "./run";

function mkUnit(id: string, over: Partial<Parameters<typeof createUnit>[0]> = {}): Unit {
  return createUnit({
    id,
    side: "player",
    pos: { col: 0, row: 0 },
    speed: 10,
    maxHp: 20,
    attack: 5,
    defense: 2,
    moveRange: 3,
    sightRadius: 6,
    ...over,
  });
}

/** A minimal run carrying only what the journal reads. */
function mkRun(
  party: Unit[],
  opts: { gearWear?: number; rescueQuests?: RescueQuest[] } = {},
): RunState {
  const camp: Camp = createCamp({ morale: 0 });
  camp.gearWear = opts.gearWear ?? 0;
  return { party, camp, rescueQuests: opts.rescueQuests ?? [] } as unknown as RunState;
}

function dying(id: string, nights: number): Unit {
  const u = mkUnit(id, { hp: 0 });
  u.alive = false;
  u.counters[DYING_COUNTER] = nights;
  return u;
}

describe("captainsJournal (party-blindness projection — pure read)", () => {
  it("is empty when nothing nags", () => {
    expect(captainsJournal(mkRun([mkUnit("ok")]))).toEqual([]);
    expect(hasConcerns(mkRun([mkUnit("ok")]))).toBe(false);
  });

  it("surfaces worn-gear debt, escalating note → warning at the threshold", () => {
    const note = captainsJournal(mkRun([mkUnit("a")], { gearWear: 1 }))[0];
    expect(note).toMatchObject({ kind: "gear-wear", severity: "note", value: 1 });

    const warn = captainsJournal(mkRun([mkUnit("a")], { gearWear: GEAR_WEAR_WARN }))[0];
    expect(warn).toMatchObject({ kind: "gear-wear", severity: "warning", value: GEAR_WEAR_WARN });
  });

  it("surfaces each dying companion with nights left; urgent at ≤1 night", () => {
    const concerns = captainsJournal(mkRun([dying("pip", 3), dying("rok", 1)]));
    const pip = concerns.find((c) => c.subject === "pip");
    const rok = concerns.find((c) => c.subject === "rok");
    expect(pip).toMatchObject({ kind: "dying", severity: "warning", value: 3 });
    expect(rok).toMatchObject({ kind: "dying", severity: "urgent", value: 1 });
  });

  it("surfaces an outstanding rescue, naming the still-listed roster member", () => {
    const sela = mkUnit("sela-id", { name: "Sela" });
    sela.captured = true;
    const quest: RescueQuest = { unitId: "sela-id", resolution: "rescue-narrow", nights: 3, deploymentPenalty: 2 };
    const concerns = captainsJournal(mkRun([sela], { rescueQuests: [quest] }));
    expect(concerns).toContainEqual({ kind: "rescue", severity: "warning", subject: "Sela", value: 3 });
  });

  it("falls back to the unit id when the captive has left the roster", () => {
    const quest: RescueQuest = { unitId: "ghost", resolution: "rescue-tight", nights: 1, deploymentPenalty: 3 };
    const [concern] = captainsJournal(mkRun([], { rescueQuests: [quest] }));
    expect(concern).toMatchObject({ kind: "rescue", severity: "urgent", subject: "ghost" });
  });

  it("orders worst-first: urgent before warning before note", () => {
    const run = mkRun([dying("urgent-one", 1), dying("warn-one", 3)], { gearWear: 1 });
    const severities = captainsJournal(run).map((c) => c.severity);
    expect(severities).toEqual(["urgent", "warning", "note"]);
  });
});
