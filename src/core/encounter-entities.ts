/**
 * **Encounter entities** — the factories that turn an {@link EncounterLayout}'s data into the live
 * things on a board: enemy and captive {@link Unit}s, {@link Gate}s and {@link Lever}s, and the
 * concealed enemy traps. One place per kind of thing, shared by every way a level is made, so an
 * authored level and a procedural one build an enemy from a template the same way.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord } from "./iso";
import { createUnit, type Unit, type UnitSpec } from "./units";
import type { EnemyDef } from "./generation"; // type-only (erased) — no runtime cycle
import { TAGS } from "./tags";
import { makeGate, makeLever, type Gate, type Lever } from "./gates";
import { makeConcealedTrap, type EntityRegistry } from "./entities";
import type { EncounterLayout } from "./encounter-layout";

/** An enemy's stat block straight off its template (D4: enemies are data) — scale or override it after. */
export function enemySpecFromTemplate(tpl: EnemyDef, id: string, pos: GridCoord): UnitSpec {
  return {
    id,
    name: tpl.name,
    side: "enemy",
    pos,
    speed: tpl.speed,
    maxHp: tpl.maxHp,
    attack: tpl.attack,
    defense: tpl.defense,
    moveRange: tpl.moveRange,
    sightRadius: tpl.sightRadius,
    awareness: tpl.awareness,
    thief: tpl.thief,
    attackRange: tpl.attackRange,
    jobId: tpl.jobId,
  };
}

/**
 * Fail loud (D117) if a staged unit carries an **intrinsic tag not in the {@link TAGS} registry** —
 * a designer typo (`"garrsion"`) would otherwise be a silent no-op (the tag never matches its constant).
 * Every enemy and captive stages through here, so a bad tag can't reach the board unnoticed.
 */
function assertRegisteredTags(u: Unit): void {
  for (const t of u.tags) {
    if (!TAGS[t]) throw new Error(`staged unit "${u.id}" carries unregistered tag "${t}" (not in TAGS)`);
  }
}

/**
 * The layout's enemies as live units. A hidden ambush body stays hidden unless `revealHidden` —
 * a node scouted to full positional intel blows the ambush (D10).
 */
export function spawnEnemies(layout: EncounterLayout, revealHidden = false): Unit[] {
  return layout.enemies.map(({ spec, hidden }) => {
    const u = createUnit(spec);
    u.hidden = hidden && !revealHidden;
    assertRegisteredTags(u);
    return u;
  });
}

/**
 * The layout's captives as live, **bound** player units (D52): forced player-side and authored (a
 * freed authored cast member joins permanently), and stamped `captured` so each stages as a grey
 * token — off the initiative clock, never an AI target, a rescuable sub-objective.
 */
export function spawnCaptives(layout: EncounterLayout): Unit[] {
  return layout.captives.map((c) => {
    const u = createUnit({ ...c.spec, side: "player", pos: c.pos, authored: true, release: c.release });
    u.captured = true;
    assertRegisteredTags(u);
    return u;
  });
}

/** The layout's gates as live {@link Gate}s — locked unless the placement says otherwise (D103). */
export function spawnGates(layout: EncounterLayout): Gate[] {
  return layout.gates.map((g) => makeGate(g.id, g.pos, g.openBy, g.locked ?? true));
}

/** The layout's levers as live {@link Lever}s (D103). */
export function spawnLevers(layout: EncounterLayout): Lever[] {
  return layout.levers.map((l) => makeLever(l.id, l.pos, l.targets));
}

/**
 * Pre-place the layout's concealed enemy traps on the battle's entity registry (D12). They ride the
 * same registry the player's Set Trap uses, so movement springs them and the Survivalist can disarm
 * them. Traps concealed at or below `markUpTo` stage already revealed — the tier-3 careless mark (D83).
 */
export function registerEncounterTraps(registry: EntityRegistry, layout: EncounterLayout, markUpTo?: number): void {
  for (const t of layout.traps) {
    const trap = makeConcealedTrap(t.id ?? `enemy-trap@${t.pos.col},${t.pos.row}`, t.pos, "enemy", t.damage ?? 12, t.concealment ?? 4);
    if (markUpTo !== undefined && trap.concealment <= markUpTo) trap.revealed = true;
    registry.register(trap);
  }
}
