import { describe, it, expect } from "vitest";
import { Rng, hashSeed, streamFor } from "./rng";

describe("Rng — determinism", () => {
  it("the same seed produces an identical sequence", () => {
    const a = new Rng("campfire");
    const b = new Rng("campfire");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds diverge", () => {
    const a = Array.from({ length: 20 }, () => new Rng("seed-a").next());
    const b = Array.from({ length: 20 }, () => new Rng("seed-b").next());
    expect(a).not.toEqual(b);
  });

  it("numeric and string seeds are both stable", () => {
    expect(hashSeed(42)).toBe(hashSeed(42));
    expect(hashSeed("42")).toBe(hashSeed("42"));
    expect(new Rng(7).int(1000)).toBe(new Rng(7).int(1000));
  });

  it("int / range / pick stay within bounds", () => {
    const rng = new Rng("bounds");
    for (let i = 0; i < 500; i++) {
      const n = rng.int(10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
      const r = rng.range(3, 6);
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThanOrEqual(6);
    }
    const arr = ["a", "b", "c"];
    expect(arr).toContain(rng.pick(arr));
  });

  it("pickWeighted respects weights (never picks a zero-weight item)", () => {
    const rng = new Rng("weights");
    const items = [
      { id: "never", w: 0 },
      { id: "always", w: 5 },
    ];
    for (let i = 0; i < 100; i++) {
      expect(rng.pickWeighted(items, (x) => x.w).id).toBe("always");
    }
  });
});

describe("Rng — fork independence", () => {
  it("a fork is independent and reproducible; parent draws are unaffected", () => {
    const parent = new Rng("fork-test");
    const childA = parent.fork();
    const afterFork1 = parent.next();

    const parent2 = new Rng("fork-test");
    const childB = parent2.fork();
    const afterFork2 = parent2.next();

    // The forked children match each other and the parent resumes identically.
    expect(Array.from({ length: 10 }, () => childA.next())).toEqual(
      Array.from({ length: 10 }, () => childB.next()),
    );
    expect(afterFork1).toBe(afterFork2);
  });

  it("streamFor derives the same labelled stream every time", () => {
    const s1 = streamFor("run-1", "enc:3");
    const s2 = streamFor("run-1", "enc:3");
    expect(Array.from({ length: 8 }, () => s1.next())).toEqual(
      Array.from({ length: 8 }, () => s2.next()),
    );
    // A different label diverges.
    const s3 = streamFor("run-1", "enc:4");
    expect(s3.next()).not.toBe(s1.next());
  });
});

describe("Rng — serialize / restore", () => {
  it("serialize → restore reproduces subsequent draws", () => {
    const rng = new Rng("save");
    for (let i = 0; i < 5; i++) rng.next(); // advance partway
    const saved = rng.state();

    const expected = Array.from({ length: 10 }, () => rng.next());

    const restored = Rng.fromState(saved, "save");
    const actual = Array.from({ length: 10 }, () => restored.next());
    expect(actual).toEqual(expected);
  });
});

describe("no Math.random in core/", () => {
  it("grep: no core module calls Math.random", () => {
    // Load every non-test core source as raw text via Vite's glob (no Node fs).
    // Recursive: jobs-data/ and scenarios/ are core too (audit 2026-07-20).
    const sources = import.meta.glob("./**/*.ts", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (path.endsWith(".test.ts")) continue;
      // Match an actual call (`Math.random(`), not a prose mention in a comment.
      if (/Math\.random\s*\(/.test(src)) offenders.push(path);
    }
    // Sanity: the glob actually found the core modules.
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
