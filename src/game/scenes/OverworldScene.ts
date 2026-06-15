import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import {
  RunLoop,
  previewNode,
  slotsUsed,
  countOf,
  moraleTier,
  // M8 — the overworld action economy (D35)
  getAbility,
  cooldownRemaining,
  scoutedTier,
  fatigueTier,
  fatiguePenalty,
  unitSkills,
  applyCampSkill,
  addItem,
  triageHeal,
  chunkHp,
  runDifficulty,
  combatRoster,
  // M10 — the gold economy verbs (D30/D34) + theft (D30)
  merchantBuy,
  bankerEngageInterest,
  bankerBorrow,
  bankerProtect,
  collectPoliticalIncome,
  ECONOMY,
  // M11 — the data-driven event-node registry (D4/D23)
  eventForNode,
  storyForNode,
  type RunState,
  type MapNode,
  type NodePreview,
  type RestResult,
  type EventOutcome,
  type EventChoice,
  type EventKind,
  type Unit,
  type OverworldAbility,
  type ActionResult,
  type SkillDef,
  type Guild,
} from "../../core";
import { fitText } from "../ui";
import { Button } from "../button";
import { HintPanel } from "../hint-panel";

/** Data handed between the overworld and a combat node's BattleScene. */
export interface RunHandoff {
  run: RunState;
  loop: RunLoop;
  /** The owning guild (M9) — threaded so a terminal can return to the hall. */
  guild?: Guild;
  /** The caravan whose run this is — the hall resolves it on a terminal (D27). */
  caravanId?: string;
}

/**
 * The **overworld** screen — the seeded, branching run map (D22) and, since M8,
 * the **unified overworld camp** (D35). It owns the run + {@link RunLoop} and is
 * the screen the player returns to between missions: it draws the layered node DAG,
 * highlights the **reachable** nodes, and previews each with banded intel (D24).
 *
 * **M8 — camp at every node (D35).** Choosing a node no longer plays it straight
 * away; it opens **one unified camp** (the title callback) where the player takes
 * **overworld actions** — gated by per-ability **node-step cooldowns** (the spine)
 * and per-character **fatigue** (a loose guardrail) — then **commits**. This folds
 * the old separate Meta-phase screen in: the camp's meta skills (Chef/Merchant),
 * provisioning and triage now live here, alongside the new overworld economy. A
 * **combat** node's commit hands off to {@link "./BattleScene"} (Deployment → Battle
 * → Resolution, unchanged downstream); a **rest** node recovers in place and
 * **restores fatigue** (D23/D35). On a wipe it shows the **run-end** screen (seed
 * for replay); on clearing the final node, a **run complete** screen. It owns no
 * rules — every decision flows through the loop.
 */
export class OverworldScene extends Phaser.Scene {
  private run!: RunState;
  private loop!: RunLoop;
  private guild?: Guild;
  private caravanId?: string;

  private graph?: Phaser.GameObjects.Graphics;
  private nodePos = new Map<string, { x: number; y: number }>();
  private nodeObjects: Phaser.GameObjects.GameObject[] = [];
  private overlay: Phaser.GameObjects.GameObject[] = [];

  // The unified overworld camp (D35): objects + the node currently camped at.
  private campObjects: Phaser.GameObjects.GameObject[] = [];
  private campNode?: MapNode;

  private titleText!: Phaser.GameObjects.Text;
  private campText!: Phaser.GameObjects.Text;
  private previewText!: Phaser.GameObjects.Text;
  private hintPanel!: HintPanel;

  constructor() {
    super("OverworldScene");
  }

  /** Resume data: an in-flight run+loop (from the hall, or back from a BattleScene). */
  init(data?: Partial<RunHandoff>): void {
    this.run = data?.run as RunState;
    this.loop = data?.loop as RunLoop;
    this.guild = data?.guild;
    this.caravanId = data?.caravanId;
  }

  create(): void {
    // The New Guild button returns to the hall (M9 — the guild owns runs now).
    const newRunBtn = document.getElementById("newrun") as HTMLButtonElement | null;
    if (newRunBtn) newRunBtn.onclick = () => this.scene.start("GuildScene");

    // The overworld is now ONE caravan's run, handed in by the guild hall. With
    // nothing handed in (e.g. a direct boot), bounce back to the hall.
    if (!this.run || !this.loop) {
      this.scene.start("GuildScene");
      return;
    }

    this.titleText = this.add.text(this.scale.width / 2, 16, "", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.title }).setOrigin(0.5).setDepth(10);
    this.campText = this.add.text(this.scale.width / 2, 40, "", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0.5).setDepth(10);
    this.previewText = this.add.text(this.scale.width / 2, this.scale.height - 96, "", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body, align: "center", wordWrap: { width: 720 } }).setOrigin(0.5).setDepth(10);
    this.hintPanel = new HintPanel(this);

    this.refreshCampText();

    // Terminal screens take over the map.
    if (this.loop.isOver()) return this.runEnd();
    if (this.loop.isComplete()) return this.runComplete();

    this.drawMap();
  }

  // --- Map drawing ----------------------------------------------------------

  private drawMap(): void {
    for (const o of this.nodeObjects) o.destroy();
    this.nodeObjects = [];
    this.graph?.destroy();
    this.nodePos.clear();

    const map = this.run.map;
    const reachableIds = new Set(this.loop.reachable().map((n) => n.id));
    const onPath = new Set(this.run.path);

    this.titleText.setText(`Overworld — Night ${this.run.night + 1} · choose your next move`);

    // Layout: layers left→right, nodes spread vertically within each layer.
    const marginX = 80;
    const usableW = this.scale.width - 2 * marginX;
    const centerY = this.scale.height / 2 - 20;
    const byLayer = new Map<number, MapNode[]>();
    for (const id of map.order) {
      const node = map.nodes[id];
      byLayer.set(node.layer, [...(byLayer.get(node.layer) ?? []), node]);
    }
    for (const [layer, nodes] of byLayer) {
      const x = map.layers > 1 ? marginX + (layer * usableW) / (map.layers - 1) : this.scale.width / 2;
      const rowGap = 84;
      nodes.forEach((node, i) => {
        const y = centerY + (i - (nodes.length - 1) / 2) * rowGap;
        this.nodePos.set(node.id, { x, y });
      });
    }

    // Edges underneath the nodes.
    this.graph = this.add.graphics().setDepth(0);
    for (const id of map.order) {
      const from = this.nodePos.get(id)!;
      for (const e of map.nodes[id].edges) {
        const to = this.nodePos.get(e)!;
        const live = this.run.mapNodeId === id; // edges out of the current node
        this.graph.lineStyle(live ? 3 : 1.5, live ? COLOR.accent : COLOR.border, live ? 0.9 : 0.5);
        this.graph.lineBetween(from.x, from.y, to.x, to.y);
      }
    }

    // Nodes on top.
    for (const id of map.order) {
      const node = map.nodes[id];
      const pos = this.nodePos.get(id)!;
      const reachable = reachableIds.has(id);
      const current = this.run.mapNodeId === id;
      const visited = onPath.has(id) && !current;
      this.drawNode(node, pos, { reachable, current, visited });
    }

    this.setHint("Click a node to preview it; click again to commit. ⚔ combat · ❄ rest · events: $ thief · ⚖ shop · ✚ recruiter · ? story.");
    this.previewText.setText("");
  }

  /** Glyph + tint for an event node, keyed by which event it runs (M11). */
  private eventVisual(node: MapNode): { glyph: string; color: number } {
    switch (eventForNode(this.run.seed, node).kind as EventKind) {
      case "shop": return { glyph: "⚖", color: COLOR.gold };
      case "recruiter": return { glyph: "✚", color: COLOR.info };
      case "story": return { glyph: "?", color: COLOR.captive };
      case "thief":
      default: return { glyph: "$", color: COLOR.captive };
    }
  }

  private drawNode(node: MapNode, pos: { x: number; y: number }, state: { reachable: boolean; current: boolean; visited: boolean }): void {
    const isFinal = node.layer === this.run.map.layers - 1;
    const event = node.kind === "event" ? this.eventVisual(node) : undefined;
    const baseColor =
      node.kind === "rest" ? COLOR.success : event ? event.color : isFinal ? COLOR.gold : COLOR.danger;
    const radius = isFinal ? 20 : 15;

    let alpha = 0.32;
    if (state.current) alpha = 1;
    else if (state.reachable) alpha = 1;
    else if (state.visited) alpha = 0.6;

    const circle = this.add.circle(pos.x, pos.y, radius, baseColor, alpha).setDepth(1);
    if (state.current) circle.setStrokeStyle(3, COLOR.white, 1);
    else if (state.reachable) circle.setStrokeStyle(3, COLOR.accent, 1);
    else circle.setStrokeStyle(1, COLOR.tileDark, 0.8);
    this.nodeObjects.push(circle);

    // Kind glyph (event nodes carry a per-event glyph, M11).
    const glyph = node.kind === "rest" ? "❄" : event ? event.glyph : isFinal ? "★" : "⚔";
    const label = this.add.text(pos.x, pos.y, glyph, { color: INK.onLight, fontSize: isFinal ? FONT.heading : FONT.body }).setOrigin(0.5).setDepth(2);
    this.nodeObjects.push(label);

    if (state.visited) {
      const tick = this.add.text(pos.x + radius - 2, pos.y - radius + 2, "✓", { color: INK.success, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5).setDepth(2);
      this.nodeObjects.push(tick);
    }

    if (state.reachable) {
      circle.setInteractive({ useHandCursor: true });
      circle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.showPreview(node));
      circle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.enterCamp(node));
    }
  }

  // --- Selection / preview (D24) --------------------------------------------

  private showPreview(node: MapNode): void {
    // Read at the floor + whatever Scout has bought for this node (D35).
    const p = previewNode(this.run, node.id, scoutedTier(this.run.overworld, node.id));
    this.previewText.setText(this.describePreview(p));
  }

  private describePreview(p: NodePreview): string {
    if (p.kind === "rest") return `Layer ${p.layer} · Rest — ${p.restHint}`;
    if (p.kind === "event") return `Layer ${p.layer} · Event — ${p.eventHint}`;
    const parts = [`Layer ${p.layer} · Combat (${p.encounterType})`];
    if (p.intel?.types) parts.push(`enemies: ${p.intel.types.join(", ")}`);
    else parts.push("enemies: unknown");
    if (p.intel?.count !== undefined) parts.push(`count: ${p.intel.count}`);
    if (p.intel?.grantsVision) parts.push("starting vision");
    parts.push(`reward: ${p.rewardHint ?? "unknown"}`);
    return parts.join("   ·   ");
  }

  private clearMap(): void {
    for (const o of this.nodeObjects) o.destroy();
    this.nodeObjects = [];
    this.graph?.destroy();
    this.graph = undefined;
    this.previewText.setText("");
  }

  // --- The unified overworld camp (D35) -------------------------------------

  /**
   * Open the unified camp at a chosen node: advance the run there, then surface the
   * overworld actions (cooldown- + fatigue-gated) and meta/provision actions before
   * the player commits onward. This is the single between-nodes surface (D35).
   */
  private enterCamp(node: MapNode): void {
    this.clearMap();
    this.loop.choose(node.id);
    this.campNode = node;
    this.renderCamp();
  }

  /** (Re)draw the camp panel — called after every action so readouts stay live. */
  private renderCamp(): void {
    const node = this.campNode!;
    this.clearCamp();
    this.refreshCampText();

    const isCombat = node.kind === "combat";
    const kindLabel = isCombat
      ? `Combat (layer ${node.layer})`
      : node.kind === "event"
        ? `Event — ${this.loop.eventDef().name}`
        : "Rest";
    this.titleText.setText(`Camp — Night ${this.run.night + 1} · ${kindLabel}`);
    this.setHint("Take overworld actions (cooldown- and fatigue-gated), then commit. Cooldowns tick as you advance.");

    const cx = this.scale.width / 2;
    const panelW = 720;
    const top = 90;
    const colX = cx - panelW / 2 + 30;
    const rowH = 30;

    // --- Overworld actions (the new economy, D35) ---
    this.campObjects.push(
      this.add.text(colX - 10, top - 6, "Overworld Actions", { color: INK.success, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
    );
    let y = top + 22;

    // Scout — one button per reachable node ahead (the chosen target, D24/D35).
    const scout = getAbility("scout")!;
    const ahead = this.loop.reachable();
    for (const target of ahead) {
      const actor = this.scoutActor();
      const label = `Scout → ${target.id} (${target.kind})  ·  ${this.costReadout(scout, actor)}`;
      const refusal = this.refusal(scout, actor);
      this.campButton(colX, y, 360, 24, label, !refusal, () => this.doOverworldAction(actor, "scout", { targetNodeId: target.id }), refusal ?? scout.description);
      y += rowH;
    }

    // Market — the Merchant's ACCESS verb (D30) as an overworld action.
    const market = getAbility("market")!;
    const marketActor = this.marketActor();
    const mRefusal = this.refusal(market, marketActor);
    this.campButton(colX, y, 360, 24, `${marketActor.name}: Market  ·  ${this.costReadout(market, marketActor)}`, !mRefusal, () => this.doOverworldAction(marketActor, "market"), mRefusal ?? market.description);
    y += rowH + 8;

    // --- Camp / meta actions (the folded-in Meta phase + provisioning) ---
    this.campObjects.push(
      this.add.text(colX - 10, y, "Camp", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
    );
    y += 22;
    for (const u of this.run.party) {
      for (const skill of unitSkills(u, "meta")) {
        this.campButton(colX, y, 360, 24, `${u.name}: ${skill.name}`, true, () => this.useCampSkill(skill), `${skill.name} — ${skill.description}`);
        y += rowH;
      }
    }
    this.campButton(colX, y, 360, 24, "Load Trap Kit (15g)", true, () => this.provisionTrapKit(), "Buy a Trap Kit into storage (1 slot) for the Survivalist.");
    y += rowH;
    this.campButton(colX, y, 360, 24, "Triage Heal", true, () => this.triage(), "Spend Rest Points to heal the most-wounded fighter one chunk (D9).");
    y += rowH + 8;

    // --- The gold economy verbs (M10, D30/D34): purse-scoped, never the treasury ---
    this.campObjects.push(
      this.add.text(colX - 10, y, "Economy (Merchant / Banker / Noble)", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
    );
    y += 22;
    // Merchant ACCESS — buy supply into storage from the PURSE, node-tier price.
    const buyPrice = node.kind === "rest" ? ECONOMY.merchant.townPrice : ECONOMY.merchant.wildPrice;
    this.campButton(colX, y, 360, 24, `Merchant: Buy Trap Kit (${buyPrice}g purse, ${node.kind === "rest" ? "town" : "wild"})`, true, () => this.merchantBuyKit(), "Merchant ACCESS (D30): spend run-gold to buy a Trap Kit into storage — cheaper at a town/rest node.");
    y += rowH;
    // Banker TIME-SHIFT + SECURE — purse interest, buy-on-debt, theft protection.
    this.campButton(colX, y, 360, 24, "Banker: Engage Purse Interest", true, () => this.bankerInterest(), "Banker TIME-SHIFT (D30): the carried purse accrues flat interest each node-step. Purse only — never the treasury.");
    y += rowH;
    this.campButton(colX, y, 360, 24, "Banker: Buy-on-Debt (+40g now)", true, () => this.bankerBorrow40(), "Banker (D30): overspend now; auto-repaid from incoming run gold.");
    y += rowH;
    this.campButton(colX, y, 360, 24, `Banker: Theft Protection (${ECONOMY.banker.protectionCost}g)`, true, () => this.bankerProtect(), "Banker SECURE (D30): blunt a thief's skim — battle thief and event node alike.");
    y += rowH;
    // Noble INFLUENCE — political income → Influence (a walled-off currency).
    this.campButton(colX, y, 360, 24, "Noble: Collect Political Income", !!this.guild, () => this.nobleIncome(), "Noble INFLUENCE (D30/D34): earn Influence — a separate currency that can never pay Upkeep. Bribe enemies mid-battle.");
    const leftBottom = y + 16;

    // --- Fatigue meter (per-character, banded — à la the morale readout) ---
    const meterX = cx + 60;
    this.campObjects.push(
      this.add.text(meterX, top - 6, "Fatigue", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11),
      this.add.text(meterX, top + 18, this.fatigueMeter(), { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, lineSpacing: 6 }).setOrigin(0, 0).setDepth(11),
    );
    const meterBottom = top + 18 + this.run.party.filter((u) => u.alive).length * 21 + 8;

    // --- Commit — placed below all content so it never collides with buttons ---
    const contentBottom = Math.max(leftBottom, meterBottom);
    const commitLabel = isCombat
      ? "Commit — Begin Mission"
      : node.kind === "event"
        ? "Commit — Approach the Event"
        : "Commit — Make Camp (Rest)";
    const commit = this.makeTextButton(cx, contentBottom + 26, 240, 34, commitLabel, COLOR.successDeep, COLOR.success, () => this.commit());
    this.campObjects.push(commit);

    // Backdrop sized to the actual content (added last; its low depth keeps it behind).
    const panelTop = top - 22;
    const panelBottom = contentBottom + 50;
    this.campObjects.push(
      this.add.rectangle(cx, (panelTop + panelBottom) / 2, panelW, panelBottom - panelTop, COLOR.surface, 0.96).setStrokeStyle(2, COLOR.border).setDepth(8),
    );
  }

  /** A human-readable cost line for an overworld ability (cooldown + fatigue + gold). */
  private costReadout(ability: OverworldAbility, actor: Unit): string {
    const cd = cooldownRemaining(this.run.overworld, ability.id);
    const cdStr = cd > 0 ? `${cd} node${cd === 1 ? "" : "s"}` : "ready";
    const parts = [`cd: ${cdStr}`];
    const baseFat = ability.cost.fatigue ?? 0;
    if (baseFat > 0) {
      const surcharge = fatiguePenalty(actor.fatigue).surcharge;
      parts.push(`fatigue: ${baseFat + surcharge}${surcharge > 0 ? " (tired)" : ""}`);
    }
    if (ability.cost.gold) parts.push(`gold: ${ability.cost.gold}`);
    return parts.join(", ");
  }

  /** Why an ability would refuse right now (cooldown / exhaustion / gold), or null. */
  private refusal(ability: OverworldAbility, actor: Unit): string | null {
    const cd = cooldownRemaining(this.run.overworld, ability.id);
    if (cd > 0) return `On cooldown — ${cd} more node${cd === 1 ? "" : "s"}.`;
    const baseFat = ability.cost.fatigue ?? 0;
    if (baseFat >= fatiguePenalty(actor.fatigue).lockAtOrAbove) return `${actor.name} is too exhausted — rest first.`;
    if (ability.cost.gold && this.run.camp.gold < ability.cost.gold) return `Not enough gold (${ability.cost.gold}g).`;
    return null;
  }

  /** Units that can act on the overworld — alive and not bound (D7). */
  private activeUnits(): Unit[] {
    return this.run.party.filter((u) => u.alive && !u.captured);
  }

  /** The acting unit for Scout: the highest-Intelligence active member (a survey skill). */
  private scoutActor(): Unit {
    const active = this.activeUnits();
    return active.reduce((best, u) => (u.intelligence > best.intelligence ? u : best), active[0] ?? this.run.party[0]);
  }

  /** The acting unit for Market: the Merchant if active, else any active member. */
  private marketActor(): Unit {
    const active = this.activeUnits();
    return active.find((u) => u.jobId === "merchant") ?? active[0] ?? this.run.party[0];
  }

  /** A banded per-character fatigue readout (overworld-only, never combat). */
  private fatigueMeter(): string {
    return this.run.party
      .filter((u) => u.alive)
      .map((u) => `${u.name}: ${fatigueTier(u.fatigue)} (${u.fatigue})`)
      .join("\n");
  }

  private doOverworldAction(actor: Unit, abilityId: string, opts: { targetNodeId?: string } = {}): void {
    const res: ActionResult = this.loop.overworldAction(actor, abilityId, opts);
    this.renderCamp();
    this.setHint(res.applied ? `${res.detail ?? "Done."}` : `Can't: ${res.reason ?? "refused."}`);
  }

  private useCampSkill(skill: SkillDef): void {
    const out = applyCampSkill(skill, this.run.camp);
    if (out.storage) this.run.inventory.storageCap = this.run.camp.storageCap;
    this.renderCamp();
    const parts: string[] = [];
    if (out.gold) parts.push(`+${out.gold} gold`);
    if (out.storage) parts.push(`+${out.storage} storage`);
    if (out.morale) parts.push(`+${out.morale} morale`);
    if (out.bankedHeal) parts.push(`banked +${out.bankedHeal} HP/unit`);
    this.setHint(`${skill.name}: ${parts.join(", ")}.`);
  }

  private provisionTrapKit(): void {
    const cost = 15;
    if (this.run.camp.gold < cost) return this.setHint("Not enough gold for a Trap Kit (15g).");
    if (addItem(this.run.inventory, "trap-kit", 1)) {
      this.run.camp.gold -= cost;
      this.renderCamp();
      this.setHint(`Bought a Trap Kit (${countOf(this.run.inventory, "trap-kit")} carried).`);
    } else {
      this.setHint("Storage full — Market or Trade for more slots.");
    }
  }

  private triage(): void {
    const policy = runDifficulty(this.run);
    const wounded = combatRoster(this.run)
      .filter((u) => u.hp < u.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!wounded) return this.setHint("No wounded fighters to heal.");
    if (this.run.rp < policy.rpPerChunk) return this.setHint(`Not enough RP (need ${policy.rpPerChunk} for a ${chunkHp(wounded)} HP chunk).`);
    const res = triageHeal(wounded, policy.rpPerChunk, policy);
    this.run.rp -= res.rpSpent;
    this.renderCamp();
    this.setHint(`Triaged ${wounded.name}: +${res.hpHealed} HP for ${res.rpSpent} RP.`);
  }

  // --- The gold economy verbs (M10, D30/D34) --------------------------------

  private merchantBuyKit(): void {
    const node = this.campNode!;
    const res = merchantBuy(this.run, "trap-kit", node.kind);
    this.renderCamp();
    this.setHint(res.applied ? `${res.detail}` : `Can't: ${res.reason}`);
  }

  private bankerInterest(): void {
    const perStep = bankerEngageInterest(this.run);
    this.renderCamp();
    this.setHint(perStep > 0 ? `Banker: purse interest engaged — +${perStep}g per node-step (purse only).` : "No purse to earn interest on.");
  }

  private bankerBorrow40(): void {
    const res = bankerBorrow(this.run, 40);
    this.renderCamp();
    this.setHint(res.applied ? `Borrowed 40g (debt ${res.debt}g) — auto-repaid from incoming loot.` : `Can't: ${res.reason}`);
  }

  private bankerProtect(): void {
    const res = bankerProtect(this.run);
    this.renderCamp();
    this.setHint(res.applied ? `Theft protection engaged (skims blunted ${Math.round((res.protection ?? 0) * 100)}%).` : `Can't: ${res.reason}`);
  }

  private nobleIncome(): void {
    if (!this.guild) return this.setHint("No guild to bank Influence.");
    const gained = collectPoliticalIncome(this.guild);
    this.renderCamp();
    this.setHint(`Noble: +${gained} Influence (guild total ${this.guild.influence}). Influence can never pay Upkeep.`);
  }

  /** A camp button that greys out (non-interactive) when disabled, with a reason on hover. */
  private campButton(x: number, y: number, w: number, h: number, text: string, enabled: boolean, onClick: () => void, description: string): void {
    const fill = enabled ? COLOR.surfaceAlt : COLOR.surfaceRaised;
    const bg = this.add.rectangle(x, y, w, h, fill).setStrokeStyle(1, enabled ? COLOR.borderSoft : COLOR.surfaceAlt).setOrigin(0, 0.5).setDepth(10);
    const label = this.add.text(x + 8, y, text, { color: enabled ? INK.bright : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(11);
    fitText(label, w - 16);
    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
    }
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.hintPanel.setText(description));
    this.campObjects.push(bg, label);
  }

  private clearCamp(): void {
    for (const o of this.campObjects) o.destroy();
    this.campObjects = [];
  }

  /** Leave the camp and play the node (D35): combat hands off; rest recovers here. */
  private commit(): void {
    const node = this.campNode!;
    this.clearCamp();
    this.campNode = undefined;
    if (node.kind === "combat") {
      // Hand the run off to the battle flow; it returns to this scene when done.
      this.scene.start("BattleScene", { run: this.run, loop: this.loop, guild: this.guild, caravanId: this.caravanId } as RunHandoff);
    } else if (node.kind === "event") {
      this.playEvent();
    } else {
      this.playRest();
    }
  }

  // --- Event nodes (the data-driven registry, M11, D4/D23) ------------------

  /** Open the event screen for the current node, dispatched by its event kind. */
  private playEvent(): void {
    const kind = this.loop.eventDef().kind;
    switch (kind) {
      case "shop": return this.showShopScreen();
      case "recruiter": return this.showRecruiterScreen();
      case "story": return this.showStoryScreen();
      case "thief":
      default: return this.playThiefEvent();
    }
  }

  /** Leave the event, record the node-step, and route to the map/terminal. */
  private finishEvent(netGold: number): void {
    this.loop.recordEventNight(netGold);
    this.refreshCampText();
    if (this.loop.isOver()) return this.runEnd();
    if (this.loop.isComplete()) return this.runComplete();
    this.drawMap();
  }

  // Thief — no choice; resolve the skim (auto path) and report it (D30).
  private playThiefEvent(): void {
    const res = this.loop.eventNode(); // auto-resolves the skim + records the night
    this.refreshCampText();
    const stolen = res.outcome.stolen ?? 0;
    const lines: string[] = [];
    if (stolen > 0) {
      lines.push(`A thief skimmed ${stolen}g off the purse on the road.`);
      const eco = this.run.overworld;
      if (eco.protection > 0) lines.push(`The Banker's protection blunted the loss (${Math.round(eco.protection * 100)}%).`);
      else lines.push("Buy the Banker's theft protection to blunt the next one.");
    } else {
      lines.push("The road was clear — the purse is intact.");
    }
    lines.push(`Purse now ${this.run.camp.gold}g.`);
    this.showOverlay(res.def.name, lines.join("\n"), stolen === 0, 520, 200, () => {
      if (this.loop.isOver()) return this.runEnd();
      if (this.loop.isComplete()) return this.runComplete();
      this.drawMap();
    });
  }

  // Shop — buy supplies into storage from the purse (Merchant verb reused, D30/D34).
  private spentAtShop = 0;
  private showShopScreen(): void {
    this.spentAtShop = 0;
    this.renderEventChoicePanel("Roadside Market", "Spend purse gold on supplies into caravan storage — never the treasury.");
  }

  // Recruiter — hire a rolled body for the purse, joining the run party (D33).
  private showRecruiterScreen(): void {
    this.renderEventChoicePanel("Wandering Sellsword", "Hire a body for purse gold — it joins the caravan for the run.");
  }

  // Story — an authored choice; each option a deterministic outcome (D23).
  private showStoryScreen(): void {
    const node = this.campNode!;
    const story = storyForNode(this.run.seed, node);
    this.renderEventChoicePanel(this.loop.eventDef().name, story.prompt);
  }

  /**
   * The shared event-choice panel (M11): the event's choices as buttons. Shop buys
   * leave the panel open (buy several, then Leave); a recruiter/story pick is
   * terminal (it resolves and continues). Re-rendered after each shop buy so the
   * readouts (purse, availability) stay live.
   */
  private renderEventChoicePanel(title: string, body: string): void {
    const def = this.loop.eventDef();
    const choices = this.loop.eventChoices();
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 20;
    const w = 560;
    const h = 130 + (choices.length + (def.kind === "shop" ? 1 : 0)) * 40;

    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.96).setStrokeStyle(2, COLOR.info).setDepth(20),
      this.add.text(cx, cy - h / 2 + 24, title, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(cx, cy - h / 2 + 58, `${body}\nPurse ${this.run.camp.gold}g`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body, align: "center", lineSpacing: 4, wordWrap: { width: w - 60 } }).setOrigin(0.5).setDepth(21),
    );

    let y = cy - h / 2 + 110;
    for (const choice of choices) {
      const enabled = choice.available;
      const fill = enabled ? COLOR.btnFill : COLOR.surfaceRaised;
      const stroke = enabled ? COLOR.info : COLOR.border;
      const btn = this.makeTextButton(cx, y, 360, 30, choice.label, fill, stroke, () => {
        if (!enabled) return;
        this.onEventChoice(choice);
      });
      if (choice.detail) btn.bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.setHint(choice.detail!));
      this.overlay.push(btn);
      y += 40;
    }

    // A shop is a multi-buy surface — add an explicit Leave that records the step.
    if (def.kind === "shop") {
      const leave = this.makeTextButton(cx, y, 360, 30, "Leave the market", COLOR.successDeep, COLOR.success, () => {
        for (const o of this.overlay) o.destroy();
        this.overlay = [];
        this.finishEvent(-this.spentAtShop);
      });
      this.overlay.push(leave.bg, leave.label);
    }
  }

  /** Apply a chosen event option, then re-render (shop) or continue (terminal). */
  private onEventChoice(choice: EventChoice): void {
    const def = this.loop.eventDef();
    const out: EventOutcome = this.loop.chooseEvent(choice.id);
    this.refreshCampText();

    if (def.kind === "shop" && choice.id.startsWith("buy:")) {
      // Stay in the market: track spend, report, re-render for the next buy.
      this.spentAtShop += -out.goldDelta;
      this.setHint(out.summary);
      this.renderEventChoicePanel("Roadside Market", "Spend purse gold on supplies into caravan storage — never the treasury.");
      return;
    }

    // Recruiter / story: a terminal pick — record the step and report the outcome.
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    const lines = [out.summary, "", `Purse now ${this.run.camp.gold}g.`];
    if (out.recruited) lines.push(`${out.recruited.name} now rides with the caravan.`);
    this.loop.recordEventNight(out.goldDelta);
    this.refreshCampText();
    const good = out.goldDelta >= 0 && out.moraleDelta >= 0;
    this.showOverlay(def.name, lines.join("\n"), good, 520, 200, () => {
      if (this.loop.isOver()) return this.runEnd();
      if (this.loop.isComplete()) return this.runComplete();
      this.drawMap();
    });
  }

  // --- Rest node (D23) -------------------------------------------------------

  private playRest(): void {
    const res = this.loop.restNode();
    this.refreshCampText();
    this.showRestScreen(res);
  }

  private showRestScreen(res: RestResult): void {
    const lines: string[] = [];
    const upkeepNote = res.upkeep.underfunded.length > 0 ? `Underfunded ${res.upkeep.underfunded.join(" + ")} — morale took a hit.` : `Upkeep paid (${res.upkeep.paid}g).`;
    lines.push(upkeepNote);
    lines.push(`Banked +${res.rpAdded} Rest Points; morale +${res.moraleGained}.`);
    if (res.healed.length) lines.push(`Triaged: ${res.healed.map((h) => `${h.unitId} +${h.hp} HP`).join(", ")}.`);
    else lines.push("No one needed triage — the party rested easy.");
    if (res.fatigueRestored.length) lines.push(`Fatigue restored: ${res.fatigueRestored.join(", ")} back to Rested.`);
    else lines.push("Everyone was already rested.");
    if (res.dyingLost.length) lines.push(`Lost to wounds: ${res.dyingLost.join(", ")}.`);

    this.showOverlay("Rest", lines.join("\n"), true, 520, 200, () => {
      if (this.loop.isOver()) return this.runEnd();
      if (this.loop.isComplete()) return this.runComplete();
      this.drawMap();
    });
  }

  // --- Terminal screens ------------------------------------------------------

  private runComplete(): void {
    const won = this.run.history.filter((h) => h.winner === "player").length;
    const toHall = !!this.guild;
    const lines = [
      "The caravan cleared its final mission — the quest is complete!",
      "",
      `Survived ${this.run.night} night(s), won ${won} encounter(s).`,
      `Surviving purse ${this.run.camp.gold}g (flows back to the treasury).`,
      "",
      toHall ? "Return to the guild hall — survivors, gear and purse come home." : `Seed:  ${this.run.seed}`,
    ];
    this.titleText.setText("Quest Complete");
    this.showOverlay("Quest Complete!", lines.join("\n"), true, 560, 250, toHall ? () => this.returnToHall() : undefined);
    this.setHint(toHall ? "Quest complete. Return to the hall to bank the survivors, gear and purse." : "Run complete.");
  }

  private runEnd(): void {
    const won = this.run.history.filter((h) => h.winner === "player").length;
    const last = this.run.history[this.run.history.length - 1];
    const toHall = !!this.guild;
    const lines = [
      last && last.winner === "enemy" ? "The caravan was overwhelmed." : "The caravan is lost.",
      "",
      `Survived ${this.run.night} night(s), won ${won} encounter(s).`,
      "",
      toHall ? "Return to the guild hall — the caravan's people and gear are lost, but the guild survives." : `Seed:  ${this.run.seed}`,
    ];
    this.titleText.setText("Caravan Wiped");
    this.showOverlay("Caravan Wiped", lines.join("\n"), false, 560, 250, toHall ? () => this.returnToHall() : undefined);
    this.setHint(toHall ? "Caravan wiped. Return to the hall — the guild survives; rebuild with a mercenary." : "Run over.");
  }

  /** Hand the run's terminal back to the guild hall, which resolves it (D27). */
  private returnToHall(): void {
    this.scene.start("GuildScene", { guild: this.guild, resolveCaravanId: this.caravanId });
  }

  // --- UI helpers ------------------------------------------------------------

  private refreshCampText(): void {
    const tier = moraleTier(this.run.camp.morale);
    const eco = this.run.overworld;
    // The PURSE is camp.gold (D34); surface the Banker's purse-scoped state too.
    const bank: string[] = [];
    if (eco.interestPerStep > 0) bank.push(`int +${eco.interestPerStep}/step`);
    if (eco.debt > 0) bank.push(`debt ${eco.debt}g`);
    if (eco.protection > 0) bank.push(`protect ${Math.round(eco.protection * 100)}%`);
    const bankStr = bank.length ? `  ·  ${bank.join(" · ")}` : "";
    const influenceStr = this.guild ? `  ·  Influence ${this.guild.influence}` : "";
    this.campText.setText(
      `Purse ${this.run.camp.gold}g  ·  Morale ${tier} (${this.run.camp.morale})  ·  ` +
        `Storage ${slotsUsed(this.run.inventory)}/${this.run.inventory.storageCap}  ·  Kits ${countOf(this.run.inventory, "trap-kit")}  ·  RP ${this.run.rp}${bankStr}${influenceStr}`,
    );
  }

  private setHint(text: string): void {
    this.hintPanel.setResting(text);
  }

  private showOverlay(title: string, body: string, good: boolean, w = 480, h = 200, onContinue?: () => void): void {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 20;
    this.overlay.push(
      this.add.rectangle(cx, cy, w, h, COLOR.bg, 0.94).setStrokeStyle(2, good ? COLOR.success : COLOR.danger).setDepth(20),
      this.add.text(cx, cy - h / 2 + 26, title, { color: good ? INK.success : INK.danger, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(21),
      this.add.text(cx, cy + 6, body, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, align: "center", lineSpacing: 4 }).setOrigin(0.5).setDepth(21),
    );
    if (onContinue) {
      const btn = this.makeTextButton(cx, cy + h / 2 - 20, 160, 30, "Continue", COLOR.successDeep, COLOR.success, () => {
        for (const o of this.overlay) o.destroy();
        this.overlay = [];
        onContinue();
      });
      this.overlay.push(btn);
    }
  }

  private makeTextButton(x: number, y: number, w: number, h: number, text: string, fill: number, stroke: number, onClick: () => void): Button {
    const btn = new Button(this, x, y, { text, w, h, fill, stroke, onClick });
    this.add.existing(btn).setDepth(22);
    return btn;
  }
}
