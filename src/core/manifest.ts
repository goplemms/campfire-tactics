/**
 * Caravan manifest — a **pure projection** of run state into the cargo readout an
 * inventory screen renders (the dossier/`previewNode` pattern, for logistics).
 *
 * The overworld surfaces gold (purse) and a raw storage `used/cap`, but the *items*
 * themselves are invisible — only the trap-kit count leaks onto the HUD, while the
 * herbs and reagents (and the caravan's **party-slot** cap) are unseen. This
 * gathers the caravan's limits and carried stock so an inventory page can answer
 * "what do we hold, what does it do, and have we room for more."
 *
 * Pure logic: no Phaser, no DOM, no `Math.random` — a deterministic read.
 */

import type { RunState } from "./run";
import { MATERIALS, countOf, slotsFor, slotsUsed, type MaterialDef } from "./inventory";
import { getEquipment } from "./equipment";
import { moraleTier, type MoraleTier } from "./camp";
import { computeUpkeep } from "./upkeep";

/** One carried-material line: how many, how many slots, what it does. */
export interface ManifestItem {
  id: string;
  name: string;
  count: number;
  /** Storage slots this stack occupies right now (0 when none carried). */
  slots: number;
  /** Survives a fight to be recovered (a trap kit) vs. spent on use (herbs, reagent). */
  recoverable: boolean;
  /** A one-line effect blurb for the player. */
  effect: string;
}

/** A titled group of manifest items (traps vs. medical). */
export interface ManifestGroup {
  title: string;
  items: ManifestItem[];
}

/** The caravan's limits + carried stock — the inventory page's content. */
export interface CaravanManifest {
  /** The vessel's display label, if the caravan is known (a guild run). */
  vesselLabel?: string;
  /** Current roster size aboard. */
  partyCount: number;
  /** The vessel's party-slot cap, if known (absent on a guild-less boot). */
  partyCapacity?: number;
  storageUsed: number;
  storageCap: number;
  storageFree: number;
  /** The run purse (gold). Flow/economy detail stays in the nested ledger. */
  purse: number;
  groups: ManifestGroup[];
}

/**
 * The always-on **HUD readout** (D58): the four decision-relevant groups — Purse,
 * Morale, Storage/Kits, RP/Upkeep. A pure projection, so the overworld and battle
 * HUDs read one source instead of each re-assembling (and drifting from) the line.
 */
export interface CampReadout {
  purse: number;
  moraleTier: MoraleTier;
  morale: number;
  storageUsed: number;
  storageCap: number;
  kits: number;
  rp: number;
  upkeep: number;
}

/** Project a run into the {@link CampReadout} HUD figures (pure). */
export function campReadout(run: RunState): CampReadout {
  return {
    purse: run.camp.gold,
    moraleTier: moraleTier(run.camp.morale),
    morale: run.camp.morale,
    storageUsed: slotsUsed(run.inventory),
    storageCap: run.inventory.storageCap,
    kits: countOf(run.inventory, "trap-kit"),
    rp: run.rp,
    upkeep: computeUpkeep(run.party).total,
  };
}

/**
 * The canonical one-line HUD string (D58) both run scenes render — the single owner
 * of the format, replacing the two hand-built lines that had drifted (Kits in parens
 * vs. split, Night prefix). Pass `night` to prefix `Night N · ` (the battle HUD).
 */
export function campReadoutLine(run: RunState, opts: { night?: number } = {}): string {
  const r = campReadout(run);
  const prefix = opts.night !== undefined ? `Night ${opts.night}  ·  ` : "";
  return (
    prefix +
    `Purse ${r.purse}g  ·  Morale ${r.moraleTier} (${r.morale})  ·  ` +
    `Storage ${r.storageUsed}/${r.storageCap}  ·  Kits ${r.kits}  ·  RP ${r.rp}  ·  Upkeep ${r.upkeep}g/night`
  );
}

/**
 * A **condensed** camp readout for the tactical phases (Deployment + Battle), where
 * the full {@link campReadoutLine} is reference noise: only the mid-mission
 * essentials — purse, morale, storage — stay, demoted from the prominent line. The
 * camp-time levers it drops (Kits, RP, Upkeep) surface where they're actually
 * spent: trap kits on the deploy status line (placed here), RP and Upkeep on the
 * overworld camp (paid there). Format owned by core, like its sibling, so the two
 * phases can't drift. Pass `night` to prefix `Night N · `.
 */
export function campChipLine(run: RunState, opts: { night?: number } = {}): string {
  const r = campReadout(run);
  const prefix = opts.night !== undefined ? `Night ${opts.night}  ·  ` : "";
  return prefix + `Purse ${r.purse}g  ·  Morale ${r.moraleTier}  ·  Storage ${r.storageUsed}/${r.storageCap}`;
}

/** A concise player-facing effect blurb for a material (data-driven where it can be). */
export function itemEffect(mat: MaterialDef): string {
  if (mat.damage != null) return `Deployable trap · ${mat.damage} dmg`;
  if (mat.medical) {
    switch (mat.id) {
      case "salve":
        return "Medic: restores HP";
      case "stimulant":
        return "Medic: grants Hastened";
      case "antidote":
        return "Medic: cleanses a debuff";
      default:
        return "Medic supply";
    }
  }
  if (mat.id === "rune-reagent") return "Rune casting fuel";
  if (mat.loot) return `Valuables · sell for ${mat.saleValue}g at a market`;
  return mat.name;
}

/** The Stores shelves, in display order — the {@link MaterialDef.category} keys mapped to
 *  their titles. A material with no category falls to "combat" (the generic functional shelf). */
const STORE_SECTIONS: { key: NonNullable<MaterialDef["category"]>; title: string }[] = [
  // Equipment leads — the "permanent" gear (kept across nights) sits above the consumables
  // and pure-value stock that turn over during a run.
  { key: "equipment", title: "Equipment" },
  { key: "combat", title: "Combat consumables" },
  { key: "healing", title: "Healing" },
  { key: "valuables", title: "Valuables" },
];

/** Options the render layer threads in (the caravan it can't read from `run` alone). */
export interface ManifestOptions {
  vesselLabel?: string;
  partyCapacity?: number;
}

/** Project a run into the caravan manifest (pure). Shows every known material —
 *  greyed at zero — so "what could we still stock" is answerable, not just "what we hold". */
export function projectManifest(run: RunState, opts: ManifestOptions = {}): CaravanManifest {
  const inv = run.inventory;
  const toItem = (mat: MaterialDef): ManifestItem => {
    const count = countOf(inv, mat.id);
    return { id: mat.id, name: mat.name, count, slots: slotsFor(mat, count), recoverable: mat.recoverable, effect: itemEffect(mat) };
  };
  // Show every known material — but equippable gear (D77) and party-gear (D78) only when
  // actually carried: an empty-slot weapon belongs to the Arms surface, and an un-owned
  // party-gear has no footprint, so neither pads the consumables catalog at zero count
  // (keeps un-upgraded runs identical). A carried one is itemized like any material.
  const all = Object.values(MATERIALS).filter((m) => (!getEquipment(m.id) && !m.partyGear) || countOf(inv, m.id) > 0);
  const used = slotsUsed(inv);
  return {
    vesselLabel: opts.vesselLabel,
    partyCount: run.party.length,
    partyCapacity: opts.partyCapacity,
    storageUsed: used,
    storageCap: inv.storageCap,
    storageFree: inv.storageCap - used,
    purse: run.camp.gold,
    groups: STORE_SECTIONS.map((s) => ({
      title: s.title,
      items: all.filter((m) => (m.category ?? "combat") === s.key).map(toItem),
    })),
  };
}
