import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import { createGuild, GUILD, type Guild } from "./guild";
import { createCaravan } from "./caravan";
import {
  refreshMercPool,
  mercPool,
  hireFromPool,
  hireRefusal,
  recruitClassify,
  recruitToRoster,
  RECRUIT,
} from "./recruitment";

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

function guildWith(seed: string, treasury = 500): Guild {
  return createGuild(seed, { roster: [fighter("Rook")], treasury, caravans: [createCaravan("alpha", "scout-cart")] });
}

describe("recruitment — the refreshing mercenary pool (D33)", () => {
  it("refreshes to a full slate", () => {
    const g = guildWith("pool");
    refreshMercPool(g);
    expect(g.mercPool.length).toBe(RECRUIT.poolSize);
    for (const m of g.mercPool) expect(m.jobId).toBeDefined();
  });

  it("the pool is deterministic for a guild seed (D22)", () => {
    const a = guildWith("pool-det");
    const b = guildWith("pool-det");
    const poolA = refreshMercPool(a).map((m) => ({ id: m.id, jobId: m.jobId, maxHp: m.maxHp, attack: m.attack, speed: m.speed }));
    const poolB = refreshMercPool(b).map((m) => ({ id: m.id, jobId: m.jobId, maxHp: m.maxHp, attack: m.attack, speed: m.speed }));
    expect(poolB).toEqual(poolA);
  });

  it("mercPool() lazily rolls a slate if empty", () => {
    const g = guildWith("pool-lazy");
    expect(g.mercPool.length).toBe(0);
    expect(mercPool(g).length).toBe(RECRUIT.poolSize);
  });
});

describe("recruitment — hiring debits the treasury (D33)", () => {
  it("hires a pool merc into the roster for treasury gold and refills the pool", () => {
    const g = guildWith("hire");
    refreshMercPool(g);
    const target = g.mercPool[0];
    const treasuryBefore = g.treasury;
    const rosterBefore = g.roster.length;

    const hired = hireFromPool(g, target.id);
    expect(hired).not.toBeNull();
    expect(hired!.id).toBe(target.id);
    expect(g.treasury).toBe(treasuryBefore - GUILD.mercCost);
    expect(g.roster.length).toBe(rosterBefore + 1);
    expect(g.roster.some((u) => u.id === target.id)).toBe(true);
    // The pool topped back up and no longer offers the hired merc.
    expect(g.mercPool.length).toBe(RECRUIT.poolSize);
    expect(g.mercPool.some((m) => m.id === target.id)).toBe(false);
  });

  it("refuses (and returns null) when the treasury can't cover the hire", () => {
    const g = guildWith("hire-broke", GUILD.mercCost - 1);
    refreshMercPool(g);
    const id = g.mercPool[0].id;
    expect(hireRefusal(g, id)).toMatch(/treasury/i);
    expect(hireFromPool(g, id)).toBeNull();
    expect(g.roster.some((u) => u.id === id)).toBe(false);
  });

  it("refuses to hire a merc not on offer", () => {
    const g = guildWith("hire-absent");
    refreshMercPool(g);
    expect(hireFromPool(g, "merc-999")).toBeNull();
  });
});

describe("recruitment — the temp↔permanent vector (the whole new rule, D33)", () => {
  it("a bribed/rescued GENERIC is temporary (gone after the fight)", () => {
    const generic = createUnit({ id: "thug", side: "enemy", pos: { col: 7, row: 0 }, name: "Thug", speed: 10, maxHp: 16, attack: 6, defense: 1, moveRange: 4, sightRadius: 5 });
    const out = recruitClassify(generic);
    expect(out.temporary).toBe(true);
    expect(out.permanent).toBe(false);

    const g = guildWith("temp");
    const rosterBefore = g.roster.length;
    expect(recruitToRoster(g, generic)).toBe(false); // never joins
    expect(g.roster.length).toBe(rosterBefore);
  });

  it("a bribed/rescued AUTHORED unit joins the roster permanently", () => {
    const named = createUnit({ id: "Sable", side: "enemy", pos: { col: 7, row: 0 }, name: "Sable", speed: 12, maxHp: 24, attack: 8, defense: 2, moveRange: 4, sightRadius: 5, authored: true });
    const out = recruitClassify(named);
    expect(out.permanent).toBe(true);
    expect(out.temporary).toBe(false);

    const g = guildWith("perm");
    const rosterBefore = g.roster.length;
    expect(recruitToRoster(g, named)).toBe(true);
    expect(g.roster.length).toBe(rosterBefore + 1);
    expect(g.roster.some((u) => u.id === "Sable")).toBe(true);
    // Idempotent: a second join is a no-op.
    expect(recruitToRoster(g, named)).toBe(false);
  });
});
