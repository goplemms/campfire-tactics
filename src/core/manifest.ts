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
  const all = Object.values(MATERIALS);
  const used = slotsUsed(inv);
  return {
    vesselLabel: opts.vesselLabel,
    partyCount: run.party.length,
    partyCapacity: opts.partyCapacity,
    storageUsed: used,
    storageCap: inv.storageCap,
    storageFree: inv.storageCap - used,
    purse: run.camp.gold,
    groups: [
      { title: "Traps & build", items: all.filter((m) => !m.medical).map(toItem) },
      { title: "Medical (herbs)", items: all.filter((m) => m.medical).map(toItem) },
    ],
  };
}
