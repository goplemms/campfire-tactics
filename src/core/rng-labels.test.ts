/**
 * R1 (#116) — the RNG label registry's two contracts.
 *
 * 1. **Value pins**: every constructor's exact string is asserted here, because a
 *    label's value is part of the deterministic-replay / future-save wire format
 *    (D27, D73) — renaming one is a **save/replay-breaking change** and must fail
 *    a test before it ships. Change a pin only with that breakage acknowledged.
 * 2. **Grep guard**: every `streamFor(` call site in `core/` outside the registry
 *    (and `rng.ts` itself) must take a `Labels.` constructor — no new ad-hoc
 *    label strings. (Follows the `no Math.random in core/` grep-test pattern,
 *    rng.test.ts.) The one sanctioned exception is a **passthrough seam** whose
 *    second argument is exactly a parameter named `label` (Battle.stream,
 *    rollSkim) — their callers hand in registry-built labels.
 */
import { describe, it, expect } from "vitest";
import { Labels } from "./rng-labels";

describe("rng-labels — value pins (renames are save/replay-breaking, #116)", () => {
  it("pins every label's exact string value", () => {
    expect(Labels.map()).toBe("map");
    expect(Labels.market("n1-2")).toBe("market:n1-2");
    expect(Labels.node("n1-2")).toBe("node:n1-2");
    expect(Labels.enc(3)).toBe("enc:3");
    expect(Labels.event("n1-2")).toBe("event:n1-2");
    expect(Labels.eventToll("n1-2")).toBe("event:n1-2:toll");
    expect(Labels.eventShop("n1-2")).toBe("event:n1-2:shop");
    expect(Labels.eventStory("n1-2")).toBe("event:n1-2:story");
    expect(Labels.eventStoryChoice("n1-2", "pay")).toBe("event:n1-2:story:pay");
    expect(Labels.eventStoryAuto("n1-2")).toBe("event:n1-2:story:auto");
    expect(Labels.early("n1-2")).toBe("early:n1-2");
    expect(Labels.tailored("n1-2")).toBe("tailored:n1-2");
    expect(Labels.forage("n1-2", 3, 0)).toBe("forage:n1-2:3:0");
    expect(Labels.deft("n1-2", 3)).toBe("deft:n1-2:3");
    expect(Labels.bribe("n1-2", "foe-1")).toBe("bribe:n1-2:foe-1");
    expect(Labels.quest(4)).toBe("quest:4");
    expect(Labels.questMain()).toBe("quest:main");
    expect(Labels.recruit("n1-2")).toBe("recruit:n1-2");
    expect(Labels.merc(2)).toBe("merc:2");
    expect(Labels.theft("n1-2")).toBe("theft:n1-2");
    expect(Labels.thief("e1")).toBe("thief:e1");
    expect(Labels.battleDraw("dmg:a->b", 7)).toBe("dmg:a->b#7");
    expect(Labels.dmg("hero", "foe")).toBe("dmg:hero->foe");
    expect(Labels.deploy()).toBe("deploy");
    expect(Labels.trapSpot()).toBe("trap-spot");
    expect(Labels.battle("n1-2", 3)).toBe("battle:n1-2:3");
    expect(Labels.expeditionSalt(7)).toBe("7");
  });

  it("every constructor is pinned (a new label must add a pin above)", () => {
    // 27 constructors ⇔ 27 pins — grow both together.
    expect(Object.keys(Labels).length).toBe(27);
  });
});

describe("rng-labels — grep guard: streamFor call sites use the registry (#116)", () => {
  it("grep: no module derives a stream or a child seed from an ad-hoc label", () => {
    // Load every non-test source as raw text via Vite's glob (no Node fs) —
    // recursive over core (jobs-data/, scenarios/) AND the game layer, so a
    // hand-built label can't hide in a subdirectory or a scene (audit 2026-07-20).
    const sources = {
      ...import.meta.glob("./**/*.ts", { eager: true, query: "?raw", import: "default" }),
      ...import.meta.glob("../game/**/*.ts", { eager: true, query: "?raw", import: "default" }),
    } as Record<string, string>;
    const offenders: string[] = [];
    let sites = 0;
    for (const [path, src] of Object.entries(sources)) {
      if (path.endsWith(".test.ts")) continue;
      if (path === "./rng.ts" || path === "./rng-labels.ts") continue;
      // Strip comments so prose mentions of `streamFor(seed, "…")` don't trip the guard.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      // `saltSeed(` (the seed-composition twin) is held to the same contract as
      // `streamFor(` — a hand-assembled `${seed}#${label}` one level above a
      // stream was exactly how labels escaped this guard before.
      const call = /(?:streamFor|saltSeed)\(([^)]*)/g;
      for (let m = call.exec(code); m !== null; m = call.exec(code)) {
        sites++;
        const args = m[1];
        const usesRegistry = args.includes("Labels.");
        // The sanctioned passthrough seam: second arg is exactly a `label` parameter.
        const isPassthrough = /,\s*label\s*$/.test(args);
        if (!usesRegistry && !isPassthrough) {
          offenders.push(`${path}: ${m[0].trim()}…)`);
        }
      }
    }
    // Sanity: the glob actually saw the migrated draw sites.
    expect(sites).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
