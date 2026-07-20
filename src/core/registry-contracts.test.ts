/**
 * Registry contract tripwires (audit 2026-07-20 / D114).
 *
 * The codebase's recurring "Def + registry const + getter" pattern duplicates each
 * record's id as both the registry key and an `id` field on the def — with nothing
 * keeping the two in sync. These guards make the whole drift class fail by name:
 *
 * 1. **key ⇔ id**: every exported `Record<string, {id}>`-shaped registry in `core/`
 *    (and `content/`) keys each record by exactly its own `id`.
 * 2. **Dual registration**: every `EQUIPMENT` entry has a same-id `MaterialDef` in
 *    `MATERIALS` (the equip surface's documented contract, equipment.ts).
 * 3. **Event registration completeness**: every authored event def actually landed in
 *    `EVENTS` as *itself* — `registerEvent` is deliberately idempotent by id (so a
 *    doubly-loaded module can't duplicate a record), which means an accidental id
 *    collision would silently *drop* the newcomer instead of failing. Reference
 *    equality here is what turns that silent shadowing into a red test.
 */
import { describe, it, expect } from "vitest";
import { EVENTS, getEvent } from "./node-events";
import { HOLLOW_MILL_EVENTS } from "./hollow-mill-events";
import { EQUIPMENT } from "./equipment";
import { MATERIALS } from "./inventory";

describe("registry contracts — key ⇔ id (audit 2026-07-20)", () => {
  it("every exported Record<string, {id}> registry keys records by their own id", () => {
    // Execute every core + content module and reflect over its exports. Core is
    // pure/headless by doctrine (D2), so eager evaluation is safe here.
    // Test modules are excluded in the glob itself — eager-importing them would
    // execute their describe/it blocks inside THIS file's run.
    const modules = {
      ...import.meta.glob(["./**/*.ts", "!./**/*.test.ts"], { eager: true }),
      ...import.meta.glob(["../content/*.ts", "!../content/*.test.ts"], { eager: true }),
    } as Record<string, Record<string, unknown>>;

    const looksLikeIdRegistry = (v: unknown): v is Record<string, { id: string }> => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
      const entries = Object.values(v);
      return (
        entries.length > 0 &&
        entries.every(
          (e) => typeof e === "object" && e !== null && typeof (e as { id?: unknown }).id === "string",
        )
      );
    };

    const offenders: string[] = [];
    let registries = 0;
    for (const [path, mod] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(mod)) {
        if (!looksLikeIdRegistry(value)) continue;
        registries++;
        for (const [key, def] of Object.entries(value)) {
          if (key !== def.id) offenders.push(`${path} ${name}["${key}"].id === "${def.id}"`);
        }
      }
    }
    // Sanity: the walk actually found the known registries (MATERIALS, EQUIPMENT,
    // BANDIT_TEMPLATES, DIFFICULTIES, VESSELS, STANDING_ORDERS, SKILLS, SCENARIOS, …).
    expect(registries).toBeGreaterThanOrEqual(8);
    expect(offenders).toEqual([]);
  });

  it("every EQUIPMENT entry is dual-registered as a same-id material", () => {
    for (const id of Object.keys(EQUIPMENT)) {
      expect(MATERIALS[id], `EQUIPMENT["${id}"] has no MaterialDef twin`).toBeDefined();
    }
  });
});

describe("registry contracts — event registration completeness", () => {
  it("every authored Hollow Mill event landed in EVENTS as itself (no silent id shadowing)", () => {
    for (const def of HOLLOW_MILL_EVENTS) {
      const registered = EVENTS.find((e) => e.id === def.id);
      expect(registered, `event "${def.id}" never registered`).toBeDefined();
      // Reference equality: an id collision with a pre-existing event would leave
      // the *other* def registered under this id — idempotency hides that silently.
      expect(registered, `event id "${def.id}" is shadowed by a different def`).toBe(def);
    }
  });

  it("the pinned guild-arc story events resolve to their own records", () => {
    expect(getEvent("guild-contact").name).toBe("The Fence's Token");
    expect(getEvent("guild-rite").name).toBe("The Guild's Rite");
  });

  it("EVENTS ids are unique", () => {
    const ids = EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
