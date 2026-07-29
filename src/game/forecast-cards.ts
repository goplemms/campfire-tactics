import Phaser from "phaser";
import { INK } from "./theme";
import { ICON } from "./icons";
import { MiniCard, type CardRow } from "./info-cards";
import { pct,
  type Unit,
  type GridCoord,
  type AbilityForecast,
  type SkillDef,
  type SafeGround,
  type DeployFront,
  type Inventory,
  reachableTiles,
  computeDamage,
  retaliationDamage,
  inAttackRange,
  orderOf,
  forecastSkill,
  aimInRange,
  isProtected,
  inDangerZone,
  captureChanceAt,
  captureEvasionFactor,
} from "../core";

/** A resolved reach entry (the {@link reachableTiles} row for a hovered tile). */
type ReachEntry = ReturnType<typeof reachableTiles>[number];

// --- Pure formatters (zero scene state, #131) --------------------------------

/**
 * The deal / hits-back / range rows for hovering `foe` (D-feel). "Deal" is the strike
 * (flank-aware); "Hits back" is the **auto-counter** the strike would provoke — `0`
 * today (no riposte/thorns mechanic), via {@link retaliationDamage}, the seam a future
 * retaliate effect plugs into. It is *not* the foe's own next turn.
 */
export function attackPreviewRows(actor: Unit, foe: Unit, units: Unit[]): CardRow[] {
  const deal = computeDamage(actor, foe, actor.attack, units);
  const back = retaliationDamage(actor, foe, units);
  const reach = inAttackRange(actor, foe);
  const skull = (n: number, t: Unit) => (n >= t.hp ? ` ${ICON.lethal.glyph}` : "");
  const rows: CardRow[] = [
    { label: "Deal", value: `${deal}${skull(deal, foe)}`, color: deal >= foe.hp ? INK.ember : INK.danger, emphasize: true },
    { label: "Hits back", value: `${back}${skull(back, actor)}`, color: back >= actor.hp ? INK.danger : INK.muted },
    { label: "Range", value: reach ? "in reach" : "move adjacent", color: reach ? INK.success : INK.muted },
  ];
  // An ordered foe telegraphs its stance (D81/D84) — the intent, never the trigger.
  const stance = orderOf(foe)?.stance;
  if (stance) rows.push({ label: "Stance", value: stance, color: INK.muted });
  return rows;
}

/** Map a tagged {@link AbilityForecast} to the forecast box's label→value rows (D64). */
export function forecastRows(fc: AbilityForecast): CardRow[] {
  const glyphs = (g?: { lethal?: boolean }) => (g?.lethal ? ` ${ICON.lethal.glyph}` : "");
  switch (fc.kind) {
    case "immediate":
    case "computed":
      return [{ label: fc.label, value: `${fc.value}${glyphs(fc.glyphs)}`, color: fc.glyphs?.lethal ? INK.ember : INK.secondary, emphasize: true }];
    case "conditional":
      // "Damage 12 (vs debuffed +4)" / "Trap — if a foe enters: 12".
      return fc.value > 0
        ? [
            { label: fc.label, value: `${fc.value}${glyphs(fc.glyphs)}`, emphasize: true },
            { label: fc.condition, value: `+${fc.bonus}`, color: INK.gold },
          ]
        : [{ label: fc.label, value: `${fc.condition}: ${fc.bonus}`, color: INK.ember }];
    case "deferred": {
      // "Mark Prey — 0 now → +2/hit (cap +8)".
      const parts: string[] = [`${fc.now} now`];
      if (fc.perHit !== undefined) parts.push(`+${fc.perHit}/hit`);
      if (fc.cap !== undefined) parts.push(`(cap +${fc.cap})`);
      if (fc.etaTurns !== undefined) parts.push(`in ~${fc.etaTurns}t`);
      return [{ label: fc.label, value: parts.join(" "), color: INK.ember }];
    }
    case "banked":
      return [{ label: fc.label, value: `+${fc.value} party · next battle`, color: INK.success }];
    case "tiered": {
      // "Morale Neutral → High" + a couple of headline modifiers from the bundle.
      const rows: CardRow[] = [{ label: fc.label, value: `${fc.from} → ${fc.to}`, color: INK.success, emphasize: true }];
      const m = fc.modifiers;
      if (m.initiativeBonus) rows.push({ label: "Initiative", value: `+${m.initiativeBonus}`, color: INK.gold });
      if (m.safeDepthBonus) rows.push({ label: "Safe depth", value: `+${m.safeDepthBonus}`, color: INK.gold });
      if (fc.banked) rows.push({ label: "Banked heal", value: `+${fc.banked} · next battle`, color: INK.success });
      return rows;
    }
    case "branching":
      // One row per herb, greyed when unavailable, the rider tag appended (D64).
      return fc.rows.map((r) => ({
        label: r.label,
        value: `+${r.value}${r.rider ? ` ${r.rider}` : ""}`,
        color: r.available ? INK.secondary : INK.disabled,
      }));
  }
}

// --- The preview card ("what happens if I commit?", #131) --------------------

/**
 * The docked **preview card** — "what happens if I commit?" — keyed to the current
 * hover/selection: an armed ability's forecast (D64), the hovered enemy's deal/hits-back,
 * a move tile's cost + tiles-left, or (in deployment) a tile's capture risk. The scene
 * routes on its live hover/armed state and hands each `show*` the resolved inputs; this
 * controller owns the {@link MiniCard} plus the docking (just under the focus card) and
 * the pure formatting. Hidden when there's nothing to preview.
 */
export class PreviewCardController {
  /** The card itself — docked just beneath the focus card, recomputed live. */
  readonly card: MiniCard;

  constructor(scene: Phaser.Scene, private readonly focusCard: MiniCard) {
    this.card = new MiniCard(scene, 8, 184, { w: 150 }).hide();
  }

  hide(): void {
    this.card.hide();
  }

  /** Show the preview card with `title`/`rows`, docked just beneath the focus card. */
  showPreview(title: string, rows: CardRow[], alpha = 1): void {
    this.card.set(title, rows).setPosition(8, this.focusCard.bottomY() + 6).setAlpha(alpha);
  }

  /**
   * The armed-ability forecast (D64): build the {@link AbilityForecast} from live state
   * and render it; an out-of-range aim still telegraphs but dims the box.
   */
  showAbilityForecast(actor: Unit, skill: SkillDef, armedAim: GridCoord | null, units: Unit[], inventory: Inventory, morale: number): void {
    if (!skill) return this.hide();
    const target = armedAim
      ? units.find((u) => u.alive && u.pos.col === armedAim.col && u.pos.row === armedAim.row)
      : undefined;
    const fc = forecastSkill(skill, actor, { target, units, inventory, morale });
    const inRange = !armedAim || aimInRange(skill, actor, armedAim);
    this.showPreview(skill.name, forecastRows(fc), inRange ? 1 : 0.4);
  }

  /** Battle hover — a foe: the strike's expected damage, the hit-back next turn, and whether it's in reach. */
  showAttackPreview(actor: Unit, foe: Unit, units: Unit[]): void {
    this.showPreview(foe.name, attackPreviewRows(actor, foe, units), inAttackRange(actor, foe) ? 1 : 0.6);
  }

  /** Battle hover — a reachable tile: this step's cost, the budget left after it, and whether the Act is still up. */
  showMovePreview(r: ReachEntry | undefined, moveBudget: number, acted: boolean): void {
    if (!r || r.path.length === 0) return this.hide();
    const left = Math.max(0, moveBudget - r.cost);
    this.showPreview("Move here", [
      { label: "Move cost", value: `${r.cost}`, color: INK.secondary },
      { label: "Tiles left", value: `${left}`, color: left > 0 ? INK.success : INK.muted, emphasize: true },
      // Reinforce that one Act can still fall before/after the move (the D60 free-move turn).
      { label: "Action", value: acted ? "spent" : "ready", color: acted ? INK.muted : INK.success },
    ]);
  }

  /** Deployment hover — a walkable tile: its capture risk for the active unit, plus the band it sits in. */
  showDeployPreview(actor: Unit, tile: GridCoord, ground: SafeGround, front: DeployFront, exposureMultiplier: number): void {
    const protectedHere = isProtected(tile, ground);
    const inNet = inDangerZone(tile, front);
    const risk = captureChanceAt(tile, ground, front, {
      evasion: captureEvasionFactor(actor),
      exposureMultiplier,
    });
    // An authored zone (D119) overrides the net, so a zone tile the net has lapped reads
    // "Safe core" with 0 risk — correct, and the whole reason a distant side door is playable.
    const band = protectedHere ? "Safe core" : inNet ? "In the net" : "Open ground";
    this.showPreview("If moved here", [
      { label: "Capture risk", value: protectedHere ? "none" : pct(risk), color: protectedHere ? INK.success : inNet ? INK.danger : INK.ember, emphasize: true },
      { label: "Zone", value: band, color: protectedHere ? INK.success : inNet ? INK.danger : INK.muted },
    ]);
  }
}
