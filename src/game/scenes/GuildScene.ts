import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import {
  createStarterGuild,
  buyArmoryGear,
  dispatch,
  dispatchRefusal,
  resolveReturn,
  hireMercenary,
  availableRoster,
  availableGear,
  getQuest,
  runFor,
  GUILD,
  getVessel,
  createCaravan,
  assignMember,
  unassignMember,
  memberRefusal,
  lockGear,
  unlockGear,
  gearRefusal,
  loadPurse,
  caravanCapacity,
  RunLoop,
  mercPool,
  hireFromPool,
  type Guild,
  type Caravan,
  type CaravanResolution,
} from "../../core";
import type { RunHandoff } from "./OverworldScene";
import { clearLayer } from "../ui";
import { showModal } from "../overlay-card";
import { Button, type ButtonOptions } from "../button";
import { HintPanel } from "../hint-panel";

/** Data handed back to the hall when a caravan reaches a terminal (D27). */
export interface GuildHandoff {
  guild: Guild;
  /** A caravan whose in-flight run hit a terminal and needs resolving. */
  resolveCaravanId?: string;
}

/**
 * The **Guild Hall** (M9, D25–D27) — the app's new entry point and persistent
 * home *between adventures*. It surfaces the four guild-tier scarcities and the
 * never-empty board: a shared **roster pool**, the **armory**, the **treasury**,
 * and the **quest board** (a main quest + a repeating generated sidequest stream).
 *
 * From here the player **assembles caravans** (pick a vessel, fill its **uniform
 * slots** from the pool, **lock gear**, set the **purse** from the treasury) and
 * **dispatches** them to quests (model C, D26: commit several in parallel). It owns
 * the {@link Guild} of N runs; **Play** hands one caravan's run to the
 * {@link "./OverworldScene"} (serial play). On a terminal the run returns here and
 * the hall **resolves** it — a **return** flows survivors/gear/purse home, a
 * **wipe** costs that caravan's people + gear while the guild survives (rebuild via
 * **Hire Mercenary**, D27). It owns no rules — every decision flows through the core.
 */
export class GuildScene extends Phaser.Scene {
  private guild!: Guild;
  private selectedCaravanId?: string;
  private selectedQuestId?: string;
  private ui: Phaser.GameObjects.GameObject[] = [];
  private banner?: CaravanResolution;
  private hint = "";
  /** The hint card: bottom-right (the only free corner here), pinned open since the
   *  hall's hints are action feedback you want visible, not opt-in tips. Created once
   *  and updated each render — it must survive the render's destroy-everything pass. */
  private hintPanel?: HintPanel;

  constructor() {
    super("GuildScene");
  }

  init(data?: Partial<GuildHandoff>): void {
    // Phaser reuses the scene instance across starts, so reset transient UI state.
    this.banner = undefined;
    this.hint = "";
    this.hintPanel = undefined; // its game object is destroyed on shutdown; recreate in create()
    if (data?.guild) {
      this.guild = data.guild;
      // A caravan whose run hit a terminal: resolve it now and surface the result.
      if (data.resolveCaravanId) {
        const caravan = data.guild.caravans.find((c) => c.id === data.resolveCaravanId);
        const gr = runFor(data.guild, data.resolveCaravanId);
        if (caravan && gr) this.banner = resolveReturn(data.guild, caravan, gr.run);
      }
    } else {
      // A fresh boot / New Guild: drop any prior guild so create() builds anew.
      this.guild = undefined as unknown as Guild;
      this.selectedCaravanId = undefined;
      this.selectedQuestId = undefined;
    }
  }

  create(): void {
    // Guild seed bar (re-enterable replay) + New Guild button.
    const seedInput = document.getElementById("seed") as HTMLInputElement | null;
    const newGuildBtn = document.getElementById("newrun") as HTMLButtonElement | null;
    if (newGuildBtn) newGuildBtn.onclick = () => this.scene.start("GuildScene");

    if (!this.guild) {
      let seed = seedInput?.value.trim() ?? "";
      if (!seed) {
        seed = `guild-${Date.now()}`;
        if (seedInput) seedInput.value = seed;
      }
      this.guild = this.freshGuild(seed);
    }
    this.selectedCaravanId ??= this.guild.caravans.find((c) => !c.dispatched)?.id;
    this.selectedQuestId ??= this.guild.board[0]?.id;

    // Persistent across renders (render() rebuilds this.ui from scratch each time).
    this.hintPanel ??= new HintPanel(this, { anchor: "bottom", startPinned: true });
    if (!this.hint) this.hint = "Pick a quest and a caravan, fill the party from the pool, then Dispatch.";
    this.render();
  }

  /** A starting guild: the authored {@link "../../core".STARTING_ROSTER}, armory and
   *  treasury (all owned by core now), on two vessels. */
  private freshGuild(seed: string): Guild {
    return createStarterGuild(seed, {
      mainQuestLabel: "The Sunken Keep",
      caravans: [createCaravan("alpha", "supply-train"), createCaravan("beta", "scout-cart")],
    });
  }

  // --- Rendering ------------------------------------------------------------

  private render(): void {
    clearLayer(this.ui);

    const W = this.scale.width;
    // The persistent guild pools (D34): the TREASURY (vault), the roster, and the free
    // armory. The run PURSE lives on each caravan (shown in Assembly / surfaced on a
    // return); Influence is now **per-expedition** (D62), so it lives on the run, not here.
    this.text(W / 2, 14, `Guild Hall — Treasury ${this.guild.treasury}g  ·  Roster ${this.guild.roster.length}  ·  Armory ${availableGear(this.guild).length} free`, INK.primary, FONT.title, 0.5);

    this.drawBoard(20, 44);
    this.drawAssembly(280, 44);
    this.drawPool(560, 44);
    this.drawStable(20, 430);

    if (this.banner) this.drawBanner();
    this.hintPanel?.setResting(this.hint);
  }

  /** The quest board (never empty, D26). Click a quest to target the dispatch. */
  private drawBoard(x: number, y: number): void {
    this.text(x, y, "Quest Board", INK.gold, FONT.body, 0);
    let yy = y + 24;
    for (const q of this.guild.board) {
      const selected = q.id === this.selectedQuestId;
      const tag = q.kind === "main" ? "★" : "·";
      this.listButton(x, yy, 240, `${tag} ${q.label}${q.generated ? " (side)" : ""}`, selected, () => {
        this.selectedQuestId = q.id;
        this.setHint(`Targeting "${q.label}".`);
      });
      yy += 28;
    }
  }

  /** The caravan-assembly panel for the selected caravan. */
  private drawAssembly(x: number, y: number): void {
    const caravan = this.selectedCaravan();
    if (!caravan) {
      this.text(x, y, "Assembly", INK.success, FONT.body, 0);
      this.text(x, y + 26, "No caravan selected.", INK.muted, FONT.label, 0);
      return;
    }
    const vessel = getVessel(caravan.vesselId);
    const dispatched = caravan.dispatched;
    this.text(x, y, `Assembly — ${vessel.label}`, INK.success, FONT.body, 0);
    this.text(x, y + 20, `Slots ${caravan.party.length}/${caravanCapacity(caravan)}  ·  Storage ${caravan.storageCap}  ·  Purse ${caravan.purse}g${dispatched ? "  ·  DISPATCHED" : ""}`, INK.secondary, FONT.label, 0);

    let yy = y + 44;
    // The party (uniform slots) — click to remove (if not dispatched).
    this.text(x, yy, "Party:", INK.secondary, FONT.label, 0);
    yy += 20;
    if (caravan.party.length === 0) {
      this.text(x + 6, yy, "(empty — add from the pool →)", INK.disabled, FONT.label, 0);
      yy += 22;
    }
    for (const u of caravan.party) {
      this.listButton(x, yy, 240, `${u.name} (${u.jobId})${u.isLord ? " ♛" : ""}`, false, () => {
        if (dispatched) return this.setHint("Already dispatched — can't change the party.");
        unassignMember(caravan, u);
        this.render();
      });
      yy += 26;
    }

    // Locked gear — click to unlock.
    yy += 6;
    this.text(x, yy, "Locked gear:", INK.secondary, FONT.label, 0);
    yy += 20;
    if (caravan.gear.length === 0) {
      this.text(x + 6, yy, "(none)", INK.disabled, FONT.label, 0);
      yy += 22;
    }
    for (const g of caravan.gear) {
      this.listButton(x, yy, 240, g, false, () => {
        if (dispatched) return this.setHint("Already dispatched.");
        unlockGear(caravan, g);
        this.render();
      });
      yy += 26;
    }

    if (dispatched) return;

    // Purse slider (treasury → purse), in steps of 20.
    yy += 6;
    this.text(x, yy, "Purse (from Treasury):", INK.secondary, FONT.label, 0);
    yy += 22;
    this.smallButton(x, yy, 34, "−20", () => this.adjustPurse(caravan, -20));
    this.smallButton(x + 40, yy, 34, "+20", () => this.adjustPurse(caravan, +20));
    this.text(x + 86, yy + 2, `${caravan.purse}g`, INK.bright, FONT.body, 0);

    // Dispatch.
    yy += 38;
    const quest = this.selectedQuestId ? getQuest(this.guild, this.selectedQuestId) : undefined;
    const refusal = quest ? dispatchRefusal(this.guild, caravan, quest) : "Select a quest first.";
    this.wideButton(x, yy, 240, refusal ? `Dispatch (${refusal})` : `Dispatch → ${quest!.label}`, !refusal, () => {
      if (!quest) return;
      dispatch(this.guild, caravan, quest);
      this.setHint(`${vessel.label} dispatched to "${quest.label}". Play it from the stable.`);
      this.selectedCaravanId = this.guild.caravans.find((c) => !c.dispatched)?.id;
      this.render();
    });
  }

  /** The available roster pool + armory + the rebuild valve. */
  private drawPool(x: number, y: number): void {
    const caravan = this.selectedCaravan();
    this.text(x, y, "Roster Pool", INK.gold, FONT.body, 0);
    let yy = y + 24;
    const pool = availableRoster(this.guild);
    if (pool.length === 0) this.text(x + 6, yy, "(all committed)", INK.disabled, FONT.label, 0);
    for (const u of pool) {
      const refusal = caravan ? memberRefusal(caravan, u, this.others(caravan)) : "No caravan.";
      this.listButton(x, yy, 220, `${u.name} (${u.jobId}) Lv${u.level}`, false, () => {
        if (!caravan) return this.setHint("Select an assembling caravan first.");
        if (refusal) return this.setHint(refusal);
        assignMember(caravan, u, this.others(caravan));
        this.render();
      });
      yy += 26;
    }

    yy += 10;
    this.text(x, yy, "Armory", INK.gold, FONT.body, 0);
    yy += 24;
    const gear = availableGear(this.guild);
    if (gear.length === 0) this.text(x + 6, yy, "(all locked out)", INK.disabled, FONT.label, 0);
    for (const g of gear) {
      this.listButton(x, yy, 220, g, false, () => {
        if (!caravan) return this.setHint("Select an assembling caravan first.");
        const refusal = gearRefusal(caravan, g, this.others(caravan));
        if (refusal) return this.setHint(refusal);
        lockGear(caravan, g, this.others(caravan));
        this.render();
      });
      yy += 26;
    }

    // Treasury-funded armory buy (D34): the vault funds the armory (rule owned by core).
    yy += 8;
    const canBuyGear = this.guild.treasury >= GUILD.armoryCost;
    this.wideButton(x, yy, 220, canBuyGear ? `Buy Gear (${GUILD.armoryCost}g → armory)` : `Buy Gear (need ${GUILD.armoryCost}g)`, canBuyGear, () => {
      const gearId = buyArmoryGear(this.guild);
      if (gearId) this.setHint(`Bought ${gearId} into the armory (treasury −${GUILD.armoryCost}g).`);
      this.render();
    });

    // The refreshing mercenary pool (D33): several rolled recruits, gold-hired.
    yy += 40;
    this.text(x, yy, "Recruits (refreshing pool)", INK.gold, FONT.body, 0);
    yy += 24;
    const poolMercs = mercPool(this.guild);
    const canAffordMerc = this.guild.treasury >= GUILD.mercCost;
    for (const m of poolMercs) {
      this.listButton(x, yy, 220, `${m.name} (${m.jobId}) — ${GUILD.mercCost}g`, false, () => {
        if (!canAffordMerc) return this.setHint("Treasury can't afford a hire.");
        const hired = hireFromPool(this.guild, m.id);
        this.setHint(hired ? `Hired ${hired.name} (${hired.jobId}) from the pool.` : "Couldn't hire.");
        this.render();
      });
      yy += 26;
    }

    // The single rebuild valve (D27) — always available even with the pool empty.
    yy += 8;
    const canHire = this.guild.treasury >= GUILD.mercCost;
    this.wideButton(x, yy, 220, canHire ? `Quick Hire (valve, ${GUILD.mercCost}g)` : `Quick Hire (need ${GUILD.mercCost}g)`, canHire, () => {
      const merc = hireMercenary(this.guild);
      this.setHint(merc ? `Hired ${merc.name} (${merc.jobId}).` : "Treasury can't afford a hire.");
      this.render();
    });
  }

  /** The stable — every caravan with its status; Play an in-flight one (serial, D26). */
  private drawStable(x: number, y: number): void {
    this.text(x, y, "The Stable", INK.gold, FONT.body, 0);
    let xx = x;
    for (const c of this.guild.caravans) {
      const gr = runFor(this.guild, c.id);
      const vessel = getVessel(c.vesselId);
      const status = gr ? "IN FLIGHT" : c.party.length ? "assembling" : "empty";
      const selected = c.id === this.selectedCaravanId;
      const lines = `${vessel.label}\n[${status}]  ${c.party.length}/${caravanCapacity(c)} party`;
      const box = this.add.rectangle(xx, y + 24, 240, 70, selected ? COLOR.surfaceAlt : COLOR.surfaceRaised, 1).setStrokeStyle(2, selected ? COLOR.accent : COLOR.border).setOrigin(0, 0).setDepth(1).setInteractive({ useHandCursor: true });
      box.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        this.selectedCaravanId = c.id;
        this.render();
      });
      this.ui.push(box);
      this.ui.push(this.add.text(xx + 10, y + 32, lines, { color: INK.bright, fontFamily: FONT.family, fontSize: FONT.label, lineSpacing: 4 }).setDepth(2));

      if (gr) {
        this.smallButton(xx + 150, y + 60, 76, "▶ Play", () => this.play(c.id), 24, COLOR.successDeep, COLOR.success);
      }
      xx += 256;
    }
  }

  private drawBanner(): void {
    const r = this.banner!;
    const cx = this.scale.width / 2;
    const wiped = r.outcome === "wiped";
    const lines: string[] = [];
    if (wiped) {
      lines.push(`Caravan WIPED — lost forever: ${r.lost.join(", ") || "—"}.`);
      if (r.gearLost.length) lines.push(`Gear lost: ${r.gearLost.join(", ")}.`);
      if (r.purseLost) lines.push(`Purse lost: ${r.purseLost}g.`);
      if (r.lordLost) lines.push("A LORD fell — (game-over/reload is a later pass).");
      lines.push("The guild survives. Rebuild with a mercenary hire.");
    } else {
      lines.push(`Caravan RETURNED — survivors: ${r.survivors.join(", ") || "—"}.`);
      if (r.lost.length) lines.push(`Fell on the road: ${r.lost.join(", ")}.`);
      if (r.gearReturned.length) lines.push(`Gear returned: ${r.gearReturned.join(", ")}.`);
      lines.push(`Purse returned to treasury: ${r.purseReturned}g.`);
      if (r.payout) lines.push(`Quest payout banked to treasury: +${r.payout}g.`);
    }
    const w = 560;
    const h = 40 + lines.length * 20;
    const cy = this.scale.height / 2 - 40;
    // The shared modal frame (#133): same box/title/body as the old hand-rolled card,
    // plus the input-swallowing backdrop the hall was missing (the D75 bug class —
    // clicks used to bleed through to the roster/pool/stable behind the banner).
    showModal(this, this.ui, {
      title: wiped ? "Caravan Lost" : "Caravan Home",
      tone: wiped ? "bad" : "good",
      w, h, cy, depth: 30,
      boxAlpha: 0.97,
      titleOffset: 18,
      titleSize: FONT.title,
      body: { text: lines.join("\n"), offset: h / 2 + 6, color: INK.secondary, lineSpacing: 4 },
    });
    // Above the box (30) and its backdrop (29) — the scene's default button depth (2)
    // would be swallowed by the backdrop.
    this.addButton(cx, cy + h / 2 - 4, 32, {
      text: "Dismiss", w: 100, h: 26, fill: COLOR.successDeep, stroke: COLOR.success, strokeWidth: 1,
      color: INK.onSuccess, fontSize: FONT.label, pad: 12,
      onClick: () => {
        this.banner = undefined;
        this.render();
      },
    });
  }

  // --- Actions --------------------------------------------------------------

  private play(caravanId: string): void {
    const gr = runFor(this.guild, caravanId);
    if (!gr) return;
    const loop = new RunLoop(gr.run);
    this.scene.start("OverworldScene", { run: gr.run, loop, guild: this.guild, caravanId } as RunHandoff);
  }

  private adjustPurse(caravan: Caravan, delta: number): void {
    // The treasury still holds the gold until dispatch debits it (D34), so the
    // purse can be loaded up to the whole live vault.
    const next = Math.max(0, Math.min(this.guild.treasury, caravan.purse + delta));
    loadPurse(caravan, next);
    this.render();
  }

  private selectedCaravan(): Caravan | undefined {
    return this.guild.caravans.find((c) => c.id === this.selectedCaravanId);
  }

  /** The rest of the stable (for the cross-caravan lock checks). */
  private others(caravan: Caravan): Caravan[] {
    return this.guild.caravans.filter((c) => c.id !== caravan.id);
  }

  private setHint(text: string): void {
    this.hint = text;
    this.render();
  }

  // --- Small UI helpers -----------------------------------------------------

  private text(x: number, y: number, s: string, color: string, size: string, originX: number): void {
    this.ui.push(this.add.text(x, y, s, { color, fontFamily: FONT.family, fontSize: size }).setOrigin(originX, 0).setDepth(10));
  }

  /** Build a {@link Button}, register it for the render-clear pass, and depth-sort it.
   *  The shared component handles the rect + fitted label + pointer/hover wiring; these
   *  three helpers just supply the hall's flat-button geometry (top-left x/y → centre). */
  private addButton(cx: number, cy: number, depth: number, opts: ButtonOptions): void {
    const b = new Button(this, cx, cy, opts).setDepth(depth);
    this.add.existing(b);
    this.ui.push(b);
  }

  /** A left-aligned list row (quest/party/pool/armory), with a selected highlight. */
  private listButton(x: number, y: number, w: number, label: string, selected: boolean, onClick: () => void): void {
    this.addButton(x + w / 2, y + 12, 1, {
      text: label, w, h: 24,
      fill: selected ? COLOR.successDeep : COLOR.surfaceRaised,
      stroke: selected ? COLOR.accent : COLOR.border, strokeWidth: 1,
      color: INK.bright, fontSize: FONT.label, pad: 16, align: "left",
      onClick,
    });
  }

  /** A full-width action button (Dispatch / Buy Gear / Quick Hire); greyed + inert when disabled. */
  private wideButton(x: number, y: number, w: number, label: string, enabled: boolean, onClick: () => void): void {
    this.addButton(x + w / 2, y + 15, 1, {
      text: label, w, h: 30,
      fill: enabled ? COLOR.successDeep : COLOR.surfaceRaised,
      stroke: enabled ? COLOR.success : COLOR.border, strokeWidth: 2,
      color: enabled ? INK.onSuccess : INK.disabled, fontSize: FONT.label, pad: 12,
      enabled, onClick,
    });
  }

  /** A compact centred button (the ±20 purse steppers). */
  private smallButton(x: number, y: number, w: number, label: string, onClick: () => void, h = 22, fill: number = COLOR.surfaceAlt, stroke: number = COLOR.borderSoft, originX = 0): void {
    this.addButton(x + w * (0.5 - originX), y, 2, {
      text: label, w, h, fill, stroke, strokeWidth: 1,
      color: INK.onSuccess, fontSize: FONT.label, pad: 12,
      onClick,
    });
  }
}
