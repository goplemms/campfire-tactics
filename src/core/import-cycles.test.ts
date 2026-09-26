/**
 * Import-cycle tripwire (the 2026-09 design map, step 2) — `src/core`'s **runtime** import
 * graph is acyclic, and stays that way.
 *
 * Why it matters: the design atlas draws core as downward-only layers, but until this guard
 * existed nothing enforced it, and 14 modules (run · guild · jobs · skills · leveling ·
 * economy · upkeep · overworld · the verb modules · recruitment · grants) had quietly closed
 * into one loop, held together by "lazy / closure-only" comments that no test could see. A
 * cycle is init-order luck: it works until someone reads an imported binding at module top
 * level, and then it fails as `undefined is not a function` far from the edge that caused it.
 *
 * Only **runtime** edges count. `import type` / `export type` / inline `type` specifiers are
 * erased by TypeScript and never load a module, so a type-level cycle is harmless. Comments
 * are stripped first so a `{@link "./x".foo}` in a docblock is not an edge.
 *
 * Pure logic: no Phaser, no DOM.
 */
import { describe, it, expect } from "vitest";

type Graph = Map<string, Set<string>>;

/** Resolve `./x` / `../x` from `fromPath` (both relative to `src/core`) to a glob key. */
function resolveSpec(fromPath: string, spec: string): string {
  const dir = fromPath.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === ".") continue;
    if (seg === "..") dir.pop();
    else dir.push(seg);
  }
  return dir.join("/");
}

/** The runtime import edges of one source, as glob keys (`./foo`, `./jobs-data/support`). */
function runtimeEdges(path: string, src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const edges: string[] = [];
  // `import … from "./x"` and `export … from "./x"` (a re-export loads the module too).
  const stmt = /\b(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["'](\.{1,2}\/[^"']+)["']/g;
  for (let m = stmt.exec(code); m !== null; m = stmt.exec(code)) {
    const [, , typeKw, clause, spec] = m;
    if (typeKw) continue; // `import type` / `export type`: erased
    // A named clause whose every specifier is `type X` is erased too.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const specs = named[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (specs.length > 0 && specs.every((s) => /^type\s/.test(s))) continue;
    }
    edges.push(resolveSpec(path, spec));
  }
  // A bare side-effect import (`import "./x"`) loads the module too.
  const bare = /\bimport\s+["'](\.{1,2}\/[^"']+)["']/g;
  for (let m = bare.exec(code); m !== null; m = bare.exec(code)) edges.push(resolveSpec(path, m[1]));
  return edges;
}

/** Tarjan's strongly-connected components; returns only the non-trivial ones. */
function cycles(graph: Graph): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string): void => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) out.push(comp.sort());
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) visit(v);
  return out.sort((a, b) => b.length - a.length);
}

describe("import cycles — src/core's runtime import graph is acyclic (design map, step 2)", () => {
  const sources = import.meta.glob("./**/*.ts", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

  function coreGraph(): Graph {
    const graph: Graph = new Map();
    for (const [path, src] of Object.entries(sources)) {
      if (path.endsWith(".test.ts")) continue;
      const key = path.replace(/\.ts$/, "");
      const edges = runtimeEdges(key, src).filter((e) => e in sources || `${e}.ts` in sources || `${e}/index.ts` in sources);
      graph.set(key, new Set(edges.map((e) => (`${e}/index.ts` in sources && !(`${e}.ts` in sources) ? `${e}/index` : e))));
    }
    return graph;
  }

  it("the edge parser sees runtime imports and ignores erased type-only ones", () => {
    const src = `
      import { a } from "./alpha";
      import type { B } from "./beta";
      import { type C, type D } from "./gamma";
      import { type E, f } from "./delta";
      export { g } from "./epsilon";
      export type { H } from "./zeta";
      import { x } from "./jobs-data/support";
      import "./side-effect";
      import * as ns from "./eta";
      // import { nope } from "./comment";
      /* {@link "./doc".thing} */
    `;
    expect(runtimeEdges("./here", src)).toEqual(["./alpha", "./delta", "./epsilon", "./jobs-data/support", "./eta", "./side-effect"]);
  });

  it("no strongly-connected component of size > 1 exists among the core modules", () => {
    const graph = coreGraph();
    // Sanity: the glob saw the codebase, and the edges resolve to real modules.
    expect(graph.size).toBeGreaterThan(50);
    expect(graph.get("./run")?.has("./overworld")).toBe(true);
    const found = cycles(graph);
    const report = found.map((c) => `[${c.length}] ${c.map((m) => m.replace(/^\.\//, "")).join(" ⇄ ")}`);
    expect(report, "runtime import cycles in src/core (cut the back-edge; a type-only import is fine)").toEqual([]);
  });
});
