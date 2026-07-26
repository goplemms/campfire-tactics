/**
 * The field-entity registry (D4).
 *
 * A field entity is a non-unit thing that occupies a tile and reacts to battle
 * events. M3 ships only the registry seam — no real traps/nests/runes yet
 * (those are M4–M5 data). The registry subscribes to the bus once and dispatches
 * tile-matched events to the entities standing there, so an entity is **data + a
 * callback**, never a special case in the loop.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit, Side } from "./units";
import type { GridCoord } from "./iso";
import type { EventBus } from "./event-bus";
import { applyDamage } from "./combat";
import { applyStatus, type StatusInstance } from "./status";

/** Context handed to an entity's tile callbacks. */
export interface EntityEnterContext {
  unit: Unit;
  tile: GridCoord;
  /** True when the unit was pushed/pulled onto the tile (D19). */
  forced: boolean;
  bus: EventBus;
}

/**
 * A placed field entity. All behaviour is optional callbacks — a trap fills in
 * `onUnitEnterTile`, a nest would fill in an aura hook later, etc.
 */
export interface FieldEntity {
  id: string;
  pos: GridCoord;
  /** Which side placed it (entities can be enemy-owned, D12). */
  owner?: Side;
  /** Fires when a unit enters this entity's tile (the trap/snare hook). */
  onUnitEnterTile?(ctx: EntityEnterContext): void;
  /** Fires when a unit leaves this entity's tile. */
  onUnitLeaveTile?(ctx: Omit<EntityEnterContext, "forced">): void;
}

function sameTile(a: GridCoord, b: GridCoord): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * Registers field entities and wires them to the bus. Construct it with the
 * battle's {@link EventBus}; it subscribes to enter/leave once and routes those
 * events to whichever entities occupy the affected tile.
 */
export class EntityRegistry {
  private readonly entities = new Map<string, FieldEntity>();
  private readonly bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
    this.bus.on("unitEnterTile", ({ unit, tile, forced }) => {
      for (const e of this.at(tile)) {
        e.onUnitEnterTile?.({ unit, tile, forced: forced ?? false, bus });
      }
    });
    this.bus.on("unitLeaveTile", ({ unit, tile }) => {
      for (const e of this.at(tile)) {
        e.onUnitLeaveTile?.({ unit, tile, bus });
      }
    });
  }

  /** Register (or replace) an entity. */
  register(entity: FieldEntity): void {
    this.entities.set(entity.id, entity);
  }

  /** Remove an entity by id; returns true if one was present. */
  remove(id: string): boolean {
    return this.entities.delete(id);
  }

  /** All registered entities. */
  all(): FieldEntity[] {
    return [...this.entities.values()];
  }

  /** Entities occupying a given tile. */
  at(tile: GridCoord): FieldEntity[] {
    return this.all().filter((e) => sameTile(e.pos, tile));
  }

  /**
   * Snapshot the entities' **membership + mutable flags** (`sprung` / `revealed`) for
   * a turn-undo checkpoint (combat-actions Phase 2). Combat actions don't add/remove
   * entities, so for a combat turn the membership is stable and only the flags move;
   * the Deployment `placeTrap` verb (D63) *does* register an entity mid-turn, so the
   * membership (entity refs by id) is captured too — undo then drops a trap laid
   * since the checkpoint (and would re-add a removed one). Bus wiring is untouched.
   */
  snapshot(): EntitySnapshot {
    const flags = new Map<string, EntityFlags>();
    const members = new Map<string, FieldEntity>();
    for (const e of this.entities.values()) {
      members.set(e.id, e);
      const f: EntityFlags = {};
      if ("sprung" in e) f.sprung = (e as RecoverableEntity).sprung;
      if ("revealed" in e) f.revealed = (e as ConcealedTrap).revealed;
      if ("pickedUp" in e) f.pickedUp = (e as DroppedKey).pickedUp;
      flags.set(e.id, f);
    }
    return { flags, members };
  }

  /** Roll the entities' membership + mutable flags back to a {@link snapshot} (undo). */
  restore(snap: EntitySnapshot): void {
    // Membership: drop entities added since the checkpoint; re-add any removed since.
    for (const id of [...this.entities.keys()]) {
      if (!snap.members.has(id)) this.entities.delete(id);
    }
    for (const [id, e] of snap.members) {
      if (!this.entities.has(id)) this.entities.set(id, e);
    }
    // Flags.
    for (const e of this.entities.values()) {
      const f = snap.flags.get(e.id);
      if (!f) continue;
      if (f.sprung !== undefined) (e as RecoverableEntity).sprung = f.sprung;
      if (f.revealed !== undefined) (e as ConcealedTrap).revealed = f.revealed;
      if (f.pickedUp !== undefined) (e as DroppedKey).pickedUp = f.pickedUp;
    }
  }
}

/** A single entity's undoable flag values. */
interface EntityFlags {
  sprung?: boolean;
  revealed?: boolean;
  pickedUp?: boolean;
}

/** A captured set of entity membership + flags, keyed by entity id (a turn-undo checkpoint). */
export interface EntitySnapshot {
  flags: Map<string, EntityFlags>;
  /** Entity refs by id at checkpoint time — the membership undo reconciles back to. */
  members: Map<string, FieldEntity>;
}

/**
 * A field entity carrying **durability/recovery** state (D13): whether it has
 * fired (`sprung`) and whether its material survives use (`recoverable`). On a
 * win, unsprung + recoverable entities are reclaimed in Resolution.
 */
export interface RecoverableEntity extends FieldEntity {
  /** Material this entity was built from (returned to storage on recovery). */
  materialId: string;
  /** Whether the material survives use and can be recovered (D13). */
  recoverable: boolean;
  /** True once the entity has fired/been spent. */
  sprung: boolean;
}

/**
 * The first data-defined field entity (D4): a **trap** the Survivalist places in
 * Deployment. A one-shot listener on `onUnitEnterTile` — when a unit of the
 * *opposing* side steps (or is pushed, D19) onto its tile, it deals `damage` once
 * and is spent. Carries recovery state so an *unsprung* trap returns to storage
 * on a win (D13). Later placeables (nests, runes) are the same shape.
 */
export function makeTrap(
  id: string,
  pos: GridCoord,
  owner: Side,
  damage: number,
  opts: { materialId?: string; recoverable?: boolean; status?: StatusInstance } = {},
): RecoverableEntity {
  const trap: RecoverableEntity = {
    id,
    pos: { col: pos.col, row: pos.row },
    owner,
    materialId: opts.materialId ?? "trap-kit",
    recoverable: opts.recoverable ?? true,
    sprung: false,
    onUnitEnterTile: ({ unit, bus }) => {
      if (trap.sprung || unit.side === owner) return;
      trap.sprung = true;
      applyDamage(unit, damage, bus);
      // A snare trap also debuffs (Immobilize) — which is what enables the Hunter's
      // Deadeye on the now-afflicted prey (the trapper↔Hunter synergy).
      if (opts.status) applyStatus(unit, { ...opts.status });
      bus.emit("trapSprung", { id: trap.id, tile: trap.pos, unit });
    },
  };
  return trap;
}

/** Type guard for entities that carry recovery state. */
export function isRecoverable(e: FieldEntity): e is RecoverableEntity {
  return (e as RecoverableEntity).recoverable !== undefined;
}

/**
 * A **concealed** trap (the enemy trap-field, D12): like {@link makeTrap} it springs
 * on the opposing side's entry, but it starts **hidden** (`revealed=false`) and
 * carries a `concealment` rating that resists the spotter's Awareness roll. It is
 * **not** auto-salvaged on a win (`recoverable=false`) — the only way to pocket its
 * kit is for a trap-trained unit to *disarm* a spotted one (see `core/traps`).
 */
export interface ConcealedTrap extends RecoverableEntity {
  /** Resists the Awareness spot roll — higher is harder to see (D11 awareness). */
  concealment: number;
  /** True once a unit has spotted it (then it can be avoided or disarmed). */
  revealed: boolean;
}

/** Type guard for concealed traps. */
export function isConcealedTrap(e: FieldEntity): e is ConcealedTrap {
  return (e as ConcealedTrap).concealment !== undefined && (e as ConcealedTrap).revealed !== undefined;
}

/**
 * A **dropped key** field entity (D117/M5) — the physical key a fallen keyholder leaves at his tile when his
 * gate is authored `dropOnDeath`. A **player** unit stepping onto its tile picks it up: the gate ids it
 * opens are stamped onto `unit.carriedKey` (which {@link "./gates".canKeyGate} then honours), and the key is
 * marked `pickedUp` (a one-shot, snapshot-undoable flag — the board glyph then clears). Deliberately **not**
 * a general item: one carried-key state + the shared `keyGate` Act, no inventory/transfer engine (D108).
 */
export interface DroppedKey extends FieldEntity {
  /** The gate ids this key turns (its fallen keyholder's `dropOnDeath` gates). */
  gates: string[];
  /** True once a unit has pocketed it — then the glyph clears and it can't be picked up again. */
  pickedUp: boolean;
}

/** Build a dropped key at `pos` that opens `gates`. Picked up by the first **player** unit to enter its tile. */
export function makeDroppedKey(id: string, pos: GridCoord, gates: readonly string[]): DroppedKey {
  const key: DroppedKey = {
    id,
    pos: { col: pos.col, row: pos.row },
    gates: [...gates],
    pickedUp: false,
    onUnitEnterTile: ({ unit, bus }) => {
      if (key.pickedUp || unit.side !== "player") return; // one-shot; the player fetches it (M5 scope)
      key.pickedUp = true;
      unit.carriedKey = [...(unit.carriedKey ?? []), ...key.gates];
      bus.emit("keyPickedUp", { unit, key: key.id, gates: [...key.gates] });
    },
  };
  return key;
}

/** Type guard for a dropped key. */
export function isDroppedKey(e: FieldEntity): e is DroppedKey {
  return Array.isArray((e as DroppedKey).gates) && typeof (e as DroppedKey).pickedUp === "boolean";
}

/**
 * Build a concealed enemy trap. Springs once on an opposing-side entry (or a D19
 * push) for `damage`, whether or not it was spotted — spotting only lets the
 * player avoid or disarm it. Harvested mid-fight via a deliberate disarm
 * (`recoverable=false` keeps it out of the *generic* D13 recovery), or swept to
 * storage by the **win** when a trap-trained survivor stands — the D82 snare
 * sweep ({@link "./resolution".recoverMaterials}).
 */
export function makeConcealedTrap(
  id: string,
  pos: GridCoord,
  owner: Side,
  damage: number,
  concealment: number,
): ConcealedTrap {
  const trap: ConcealedTrap = {
    id,
    pos: { col: pos.col, row: pos.row },
    owner,
    materialId: "trap-kit",
    recoverable: false,
    sprung: false,
    concealment,
    revealed: false,
    onUnitEnterTile: ({ unit, bus }) => {
      if (trap.sprung || unit.side === owner) return;
      trap.sprung = true;
      applyDamage(unit, damage, bus);
      bus.emit("trapSprung", { id: trap.id, tile: trap.pos, unit });
    },
  };
  return trap;
}
