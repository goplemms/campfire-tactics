import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createCamp } from "./camp";
import { createInventory } from "./inventory";
import { projectDossier, jeopardyOf, attentionCount, CRITICAL_HP_FRACTION } from "./dossier";
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

/** A minimal run carrying only what {@link projectDossier} reads. */
function mkRun(party: Unit[], inv = createInventory(8), camp = createCamp({ morale: 0 }), rp = 0): RunState {
  return { party, inventory: inv, camp, rp } as unknown as RunState;
}

describe("projectDossier (party dossier projection — pure read)", () => {
  it("derives per-member vitality, fatigue and growth rows", () => {
    const u = mkUnit("bram", { hp: 12, fatigue: 7, level: 3, xp: 40 });
    const { members } = projectDossier(mkRun([u]));
    const row = members[0];
    expect(row.name).toBe("bram");
    expect(row.hp).toBe(12);
    expect(row.maxHp).toBe(20);
    expect(row.hpFrac).toBeCloseTo(0.6);
    expect(row.fatigueLabel).toBe("Weary"); // 7 is just over the floor of 6
    expect(row.level).toBe(3);
    expect(row.xp).toBe(40);
    expect(row.xpToNext).toBe(100);
  });

  it("classifies jeopardy worst-first: dying > captured > down > critical", () => {
    const dying = mkUnit("a", { hp: 0 });
    dying.alive = false;
    dying.counters.dyingNights = 2;
    expect(jeopardyOf(dying)).toBe("dying");

    const captured = mkUnit("b");
    captured.captured = true;
    expect(jeopardyOf(captured)).toBe("captured");

    const down = mkUnit("c");
    down.alive = false;
    expect(jeopardyOf(down)).toBe("down");

    const critical = mkUnit("d", { hp: Math.floor(20 * CRITICAL_HP_FRACTION) });
    expect(jeopardyOf(critical)).toBe("critical");

    expect(jeopardyOf(mkUnit("e"))).toBeNull(); // full HP, fine
  });

  it("carries the dying-clock nights onto the row", () => {
    const u = mkUnit("a", { hp: 0 });
    u.alive = false;
    u.counters.dyingNights = 3;
    const { members } = projectDossier(mkRun([u]));
    expect(members[0].dyingNights).toBe(3);
    expect(members[0].jeopardy).toBe("dying");
  });

  it("sums the HP deficit over alive members only (the 'how much healing' figure)", () => {
    const a = mkUnit("a", { hp: 12 }); // missing 8
    const b = mkUnit("b", { hp: 5 }); //  missing 15
    const dead = mkUnit("c", { hp: 0 });
    dead.alive = false; // excluded from the deficit
    const { party } = projectDossier(mkRun([a, b, dead]));
    expect(party.hpDeficit).toBe(23);
    expect(party.woundedCount).toBe(2);
  });

  it("reads carried stock for the provisioning answer", () => {
    const inv = createInventory(8, { salve: 2, antidote: 1 });
    const { party } = projectDossier(mkRun([mkUnit("a")], inv));
    const salve = party.stock.find((s) => s.id === "salve")!;
    const stim = party.stock.find((s) => s.id === "stimulant")!;
    expect(salve.count).toBe(2);
    expect(stim.count).toBe(0); // surfaced even when held count is zero
    expect(party.storageCap).toBe(8);
  });

  it("counts urgent jeopardy for the camp badge (critical does not gate it; attention does)", () => {
    const dying = mkUnit("a", { hp: 0 });
    dying.alive = false;
    dying.counters.dyingNights = 1;
    const hurt = mkUnit("b", { hp: 4 }); // critical (<=35%) but not urgent
    const fine = mkUnit("c");
    const proj = projectDossier(mkRun([dying, hurt, fine]));
    expect(proj.party.jeopardyCount).toBe(1); // only the dying one
    expect(attentionCount(proj)).toBe(2); // dying + critical both want a look
  });

  it("projects job abilities — actives (with lock + when·how tag) and named passives", () => {
    const u = mkUnit("vale", { jobId: "scout" });
    const row = projectDossier(mkRun([u])).members[0];

    // All three Scout actives, in kit order, each tagged by when/how it's used.
    expect(row.actives.map((a) => a.name)).toEqual(["Set Snare", "Dash", "Expose"]);
    const byName = (n: string) => row.actives.find((a) => a.name === n)!;
    expect(byName("Set Snare").tag).toBe("Deploy");
    expect(byName("Dash").tag).toBe("Battle · Move");
    expect(byName("Expose").tag).toBe("Battle · Act");

    // The 2nd active gates at job level 2 — locked at level 1; the others are ready.
    expect(byName("Expose").lockedUntil).toBe(2);
    expect(byName("Dash").lockedUntil).toBeUndefined();

    // Passives surface with player-facing labels + descriptions, not bare keys.
    expect(row.passives.map((p) => p.name).sort()).toEqual(["Keen Flanker", "Lone Flanker"]);
    expect(row.passives.every((p) => p.description.length > 0)).toBe(true);
  });

  it("unlocks the gated active once the owning job reaches its level", () => {
    const u = mkUnit("vale", { jobId: "scout", jobLevels: { scout: { level: 2, xp: 0 } } });
    const expose = projectDossier(mkRun([u])).members[0].actives.find((a) => a.name === "Expose")!;
    expect(expose.lockedUntil).toBeUndefined();
  });

  it("a jobless unit has no abilities", () => {
    const row = projectDossier(mkRun([mkUnit("nobody")])).members[0];
    expect(row.actives).toEqual([]);
    expect(row.passives).toEqual([]);
  });
});
