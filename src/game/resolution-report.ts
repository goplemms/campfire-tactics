import Phaser from "phaser";
import { COLOR, FONT, INK } from "./theme";
import { ICON, type IconKey, type IconSpec } from "./icons";
import { clearLayer } from "./ui";
import {
  type Unit,
  type ResolveResult,
  jobLevelOf,
  skillsUnlockedBetween,
  skillContexts,
} from "../core";

/** One icon-led line in a resolution section — an outcome and the colour it reads as. */
export interface ReportRow {
  /** Registry icon keying the row's glyph + default tint; omit for a plain bullet. */
  icon?: IconKey;
  text: string;
  /** Text colour override (the row's valence), else the section default. */
  color?: string;
}

/** A titled group of {@link ReportRow}s — dropped entirely when it has no rows. */
export interface ReportSection {
  heading: string;
  rows: ReportRow[];
}

/** The full after-action report: a toned headline + subtitle over grouped sections. */
export interface ResolutionReport {
  title: string;
  good: boolean;
  subtitle: string;
  sections: ReportSection[];
}

/** Everything the after-action report is assembled from — the scene's live tallies, in. */
export interface ResolutionInput {
  res: ResolveResult;
  /** Gold carried off by any thief still standing at the bell (D13/D21). */
  goldEscaped: number;
  /** Names swayed to the guild roster (permanent bribe recruits, D33). */
  recruited: string[];
  /** The battle roster (for name lookups + advancement scan). */
  units: Unit[];
  /** Each player unit's job level before the fight (for the level-up delta). */
  preBattleJobLevels: Map<string, number>;
  /** Gold thieves skimmed this fight, and how much was recovered. */
  goldStolen: number;
  goldRecovered: number;
  /** Whether this win clears the run's final mission (the run-complete flourish). */
  runComplete: boolean;
}

/**
 * Build the three-way graded terminal (D50/D51) — win / objective-failure / wipe — as a
 * structured **after-action report**: a titled, toned headline and grouped, icon-led
 * sections (Spoils, The party, Advancement, Aftermath). Pure assembly off the resolved
 * result + the scene's tallies; empty sections are dropped by the renderer. The grouping
 * follows the D-UX rule — the payoff (spoils, level-ups) and the costs (casualties,
 * captures) read as distinct, colour-coded blocks instead of one grey wall.
 */
export function buildResolutionSummary(input: ResolutionInput): ResolutionReport {
  const { res, goldEscaped, recruited, units, preBattleJobLevels, goldStolen, goldRecovered, runComplete } = input;
  const won = res.result === "win";
  const title = won ? "Victory!" : res.result === "objective-failure" ? "Objective Failed — Retreat" : "Defeat";
  const subtitle = won
    ? "The field is won — gather the spoils and move on."
    : res.result === "objective-failure"
      ? "The objective was lost — the party retreats alive, the prize forfeited."
      : "The party was overwhelmed.";
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? id;

  const spoils: ReportRow[] = [];
  if (won) {
    spoils.push({ icon: "spoils", text: `+${res.goldEarned} gold`, color: INK.gold });
    spoils.push(
      res.recovered.length
        ? { icon: "loot", text: `Recovered ${res.recovered.length} unsprung trap kit${res.recovered.length === 1 ? "" : "s"}` }
        : { text: "No unsprung materials to recover.", color: INK.muted },
    );
  }

  // The party (D51): rescues and casualties apply on either survivable outcome.
  const party: ReportRow[] = [];
  if (res.rescued.length) party.push({ icon: "rescued", text: `Freed by winning the field: ${res.rescued.map(nameOf).join(", ")}`, color: INK.success });
  if (res.result !== "wipe") {
    if (res.downed.length) party.push({ icon: "fallen", text: `Downed: ${res.downed.map((d) => `${nameOf(d.unitId)} (${d.resolution})`).join(", ")}`, color: INK.ember });
    if (res.permadeaths.length) party.push({ icon: "lost", text: `Lost forever: ${res.permadeaths.map(nameOf).join(", ")}`, color: INK.danger });
  }
  // Captives left behind become rescue follow-ups (D9/D21) — name them so the
  // abandonment isn't silently dropped; the Captain's Journal keeps nagging after.
  if (res.rescueQuests.length) party.push({ icon: "captive", text: `Captured — needs rescue: ${res.rescueQuests.map((q) => nameOf(q.unitId)).join(", ")}`, color: INK.ember });

  // Advancement (D53): who reached a new job level, with their new actives.
  const advancement: ReportRow[] = [];
  for (const u of units) {
    if (u.side !== "player") continue;
    const was = preBattleJobLevels.get(u.id) ?? jobLevelOf(u, u.primaryJob);
    const now = jobLevelOf(u, u.primaryJob);
    if (now > was) {
      // The abilities this level-up just unlocked, across all surfaces (D74) — not the
      // cumulative set, so the readout reads as a reveal ("unlocked Recon"), not a roster.
      const fresh = skillsUnlockedBetween(u, was, now);
      const names = fresh.map((s) => s.name).join(", ");
      // Call out a newly-unlocked overworld verb — the between-nodes action the player can
      // now use on the *map* (e.g. the Scout's Survey at L2): the teaching beat.
      const overworld = fresh.some((s) => skillContexts(s).includes("overworld"));
      const tail = names ? ` — unlocked ${names}${overworld ? " (now usable on the overworld — scout a node ahead)" : ""}` : "";
      advancement.push({ icon: "levelUp", text: `${u.name} reached job L${now}${tail}`, color: INK.gold });
    }
  }

  // Aftermath (M10): theft, recruitment, and the run-complete flourish.
  const aftermath: ReportRow[] = [];
  if (goldStolen > 0) aftermath.push({ icon: "theft", text: `Thieves skimmed ${goldStolen}g — recovered ${goldRecovered}g${goldEscaped > 0 ? `, ${goldEscaped}g escaped` : ""}`, color: INK.ember });
  if (recruited.length) aftermath.push({ icon: "recruited", text: `Swayed to the guild (permanent): ${recruited.join(", ")}`, color: INK.cyan });
  if (won && runComplete) aftermath.push({ icon: "levelUp", text: "The final mission is cleared — the run is complete!", color: INK.gold });

  const sections: ReportSection[] = [
    { heading: "Spoils", rows: spoils },
    { heading: "The party", rows: party },
    { heading: "Advancement", rows: advancement },
    { heading: "Aftermath", rows: aftermath },
  ];
  return { title, good: won, subtitle, sections };
}

/**
 * Render the {@link ResolutionReport} as a centred after-action card: a toned headline +
 * subtitle over icon-led, colour-coded sections. Self-sizes to its content (empty sections
 * skipped, long rows wrap) and is built in a Container pushed onto the scene's `overlay`, so
 * a single clearLayer tears the whole report down on Return to Map.
 */
export function showResolutionReport(scene: Phaser.Scene, overlay: Phaser.GameObjects.GameObject[], r: ResolutionReport): void {
  clearLayer(overlay);
  // A dimming backdrop behind the report (the D75 modal convention): the won/lost field
  // recedes so the after-action card reads on its own, instead of board unit tokens
  // ghosting through the slightly-translucent card (a visual-audit finding). Kept
  // NON-interactive so the scene's primary action button ("Return to Map") — which is
  // lifted above this in finishBattle — stays fully clickable beneath it.
  overlay.push(
    scene.add
      .rectangle(scene.scale.width / 2, scene.scale.height / 2, scene.scale.width, scene.scale.height, COLOR.black, 0.5)
      .setDepth(19),
  );
  const w = 484;
  const padX = 26;
  const leftX = -w / 2 + padX;
  const accent = r.good ? COLOR.success : COLOR.danger;
  const card = scene.add.container(scene.scale.width / 2, 0).setDepth(20);

  let y = 22;
  card.add(scene.add.text(0, y, r.title, { color: r.good ? INK.success : INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5, 0));
  y += 36;
  const sub = scene.add.text(0, y, r.subtitle, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body, align: "center", wordWrap: { width: w - 2 * padX } }).setOrigin(0.5, 0);
  card.add(sub);
  y += sub.height + 12;

  for (const sec of r.sections) {
    if (sec.rows.length === 0) continue;
    card.add(scene.add.text(leftX, y, sec.heading.toUpperCase(), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0));
    card.add(scene.add.rectangle(leftX, y + 15, w - 2 * padX, 1, COLOR.borderSoft).setOrigin(0, 0.5));
    y += 22;
    for (const row of sec.rows) {
      const spec: IconSpec | undefined = row.icon ? ICON[row.icon] : undefined;
      const glyph = scene.add.text(leftX, y, spec?.glyph ?? "·", { color: spec?.color ?? INK.muted, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0);
      const text = scene.add.text(leftX + 20, y, row.text, { color: row.color ?? INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, wordWrap: { width: w - 2 * padX - 20 } }).setOrigin(0, 0);
      card.add([glyph, text]);
      y += Math.max(text.height, 17) + 4;
    }
    y += 10;
  }

  const totalH = y + 6;
  const bg = scene.add.rectangle(0, totalH / 2, w, totalH, COLOR.bg, 0.96).setStrokeStyle(2, accent);
  card.addAt(bg, 0);
  card.setY(Math.max(8, scene.scale.height / 2 - totalH / 2));
  overlay.push(card);
}
