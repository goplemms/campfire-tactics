import type { Unit, JobId } from "../core";
import { primaryJobOf } from "../core";
import { ROLE } from "./theme";

/**
 * Per-role accent colours for board tokens. The token *fill* stays side-coloured
 * (gold ally / red foe) so friend-or-foe reads instantly; this recolours the
 * token's *ring* by the unit's role so you can also tell the knight from the
 * scout from the medic at a glance — without decoding the 2-letter initials.
 *
 * Allies key off their job; foes (which rarely carry a job) key off their name.
 */
/**
 * Per-job token-ring colour. Typed as a **total** {@link JobId} map: adding a class
 * to the registry without giving it a colour here is now a compile error, so the
 * board palette can't silently fall out of sync with the job roster.
 */
const JOB_COLORS: Record<JobId, number> = {
  soldier: ROLE.soldier,
  "heavy-knight": ROLE.soldier, // steel — frontline / tank
  hunter: ROLE.hunter, //         amber — ranged marker
  scout: ROLE.scout, //          green — mobility / recon
  assassin: ROLE.skirmisher, //   violet — the Scout's lethal prestige (unseen blade)
  thief: ROLE.skirmisher, //      violet — the Scout's utility prestige (unseen hand)
  medic: ROLE.medic, //          cyan  — sustain
  cook: ROLE.cook, //           orange — support
  merchant: ROLE.merchant, //       gold  — economy
  noble: ROLE.noble, //          violet — standing / Influence
  banker: ROLE.banker, //         blue  — purse / finance
  survivalist: ROLE.survivalist, //    leaf  — traps
  "snare-trapper": ROLE.trapper, // teal  — debuffer
};

const FOE_COLORS: { match: RegExp; color: number }[] = [
  { match: /captain|boss/i, color: ROLE.captain }, // bright — the leader
  { match: /bowman|archer/i, color: ROLE.hunter }, // amber — ranged
  { match: /cutthroat|thief|assassin/i, color: ROLE.skirmisher }, // violet — skirmisher
  { match: /trapper|snare/i, color: ROLE.trapper }, // teal — debuffer
  { match: /sapper/i, color: ROLE.sapper }, // orange — objective threat
];

/**
 * The role-accent colour for a unit's token ring, or `fallback` (its side stroke)
 * when no role is recognised.
 */
export function roleColor(unit: Unit, fallback: number): number {
  const job = primaryJobOf(unit);
  if (job) return JOB_COLORS[job];
  for (const f of FOE_COLORS) if (f.match.test(unit.name)) return f.color;
  return fallback;
}
