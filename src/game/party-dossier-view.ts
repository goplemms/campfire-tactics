/**
 * The party dossier — a between-battle roster screen: a left rail of tabs (a
 * party Overview + one per member) and a right panel of the selected member's
 * full readout (vitality, jeopardy, growth, stats, conditions).
 *
 * **Presentation-agnostic by design.** The view renders into a `bounds` rectangle
 * (never "the screen") and talks to the outside only through `data` in and an
 * `onClose` intent out — it never reaches into a scene. That decoupling is what
 * lets the same view be hosted as a full **page** today and re-hosted as a live
 * **overlay** later (a transparent backdrop over a still-running overworld) with no
 * change to this file — only the host's launch flag and the `backdrop`/`bounds`
 * it passes differ.
 */

import Phaser from "phaser";
import {
  getJob,
  primaryJobOf,
  type AbilityRow,
  type DossierProjection,
  type EquipSlot,
  type EquipSlotView,
  type Jeopardy,
  type MemberRow,
} from "../core";
import { COLOR, FONT, INK, WEIGHT } from "./theme";
import { roleColor } from "./roles";
import { hpColor, statusPips } from "./unit-readout";
import { Button } from "./button";

/** How the dossier is mounted — drives backdrop opacity (and, in the host, whether
 *  the underlying scene pauses). A page fully covers; an overlay floats over a live
 *  scene. The view only needs the backdrop distinction. */
export type DossierMode = "page" | "overlay";

export interface DossierViewOptions {
  /** The rectangle the dossier lays out inside — full viewport for a page. */
  bounds: Phaser.Geom.Rectangle;
  mode: DossierMode;
  data: DossierProjection;
  /** Intent: the player asked to leave the dossier. */
  onClose: () => void;
  /**
   * Intent: equip a carried item onto a member's matching slot (D77). When set, the
   * member card shows an interactive **Arms** panel (click a slot → pick a fitting
   * carried item). Omitted ⇒ the panel renders read-only (worn gear, no verbs). The
   * host owns the rules: it calls core `equip`/`unequip` and re-renders — the view
   * never touches the inventory or the unit, preserving the "data in / intent out" line.
   */
  onEquip?: (unitId: string, itemId: string) => void;
  /** Intent: unequip a member's slot back to the stash (D77). See {@link onEquip}. */
  onUnequip?: (unitId: string, slot: EquipSlot) => void;
  /**
   * Embedded in a host that already provides the frame (the Captain's Tent tab
   * bar + Close + backdrop). When set, the view draws **only** its rail + detail —
   * no backdrop, no title, no Back — so it reads as one tab among siblings rather
   * than a competing modal. The host owns close (and the bounds below its chrome).
   */
  embedded?: boolean;
}

/** The human label + colour for a member's standout jeopardy (`null` = none). */
function jeopardyBanner(j: Jeopardy, nights: number | null): { text: string; color: string } | null {
  switch (j) {
    case "dying":
      return { text: `⚠ Dying — ${nights ?? "?"} night(s) until lost`, color: INK.danger };
    case "captured":
      return { text: "⚠ Captured — needs rescue", color: INK.danger };
    case "down":
      return { text: "⚠ Down — out of the fight", color: INK.danger };
    case "critical":
      return { text: "⚠ Critically wounded", color: INK.ember };
    default:
      return null;
  }
}

export class PartyDossierView {
  private scene: Phaser.Scene;
  private o: DossierViewOptions;
  /** Everything drawn, for one-shot teardown. */
  private objects: Phaser.GameObjects.GameObject[] = [];
  /** Just the detail-panel objects, cleared on each tab switch. */
  private detail: Phaser.GameObjects.GameObject[] = [];
  /** Tab backings, re-tinted on selection. Index -1 = Overview. */
  private tabs: { index: number; rect: Phaser.GameObjects.Rectangle }[] = [];

  /** Detail-panel content area, set in build(). */
  private px = 0;
  private pw = 0;
  private ptop = 0;

  /** The floating description tooltip (one, reused) shown on ability hover/focus. */
  private tip?: Phaser.GameObjects.Container;

  /** The floating equip picker (bg + rows + hit zones) shown when an Arms slot is
   *  clicked (D77) — tracked flat (not a container) so its hit zones place cleanly. */
  private picker: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, o: DossierViewOptions) {
    this.scene = scene;
    this.o = o;
    this.build();
  }

  destroy(): void {
    this.hideTip();
    this.hidePicker();
    this.clear(this.detail);
    this.clear(this.objects);
    this.tabs = [];
  }

  // ---- build ---------------------------------------------------------------

  private build(): void {
    const b = this.o.bounds;
    const s = this.scene;

    // When embedded, the host (Captain's Tent) owns the backdrop, title and Close —
    // the view contributes only its rail + detail, starting at the top of its bounds.
    if (!this.o.embedded) {
      // Backdrop: a page fully covers; an overlay dims the live scene behind it.
      const backdrop =
        this.o.mode === "page"
          ? s.add.rectangle(b.centerX, b.centerY, b.width, b.height, COLOR.bg, 1).setDepth(40)
          : s.add.rectangle(b.centerX, b.centerY, b.width, b.height, COLOR.black, 0.55).setDepth(40);
      this.objects.push(backdrop);

      // Header — title + a Back button (top-right).
      this.objects.push(
        s.add
          .text(b.left + 24, b.top + 26, "Party Dossier", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.title })
          .setOrigin(0, 0.5)
          .setDepth(42),
      );
      const back = new Button(s, b.right - 70, b.top + 26, {
        text: "Back",
        w: 90,
        h: 28,
        fill: COLOR.btnFill,
        stroke: COLOR.btnStroke,
        onClick: () => this.o.onClose(),
      });
      s.add.existing(back).setDepth(43);
      this.objects.push(back);
    }

    // Layout: a fixed-width rail on the left, the detail panel filling the rest.
    const railX = b.left + 24;
    const railW = 188;
    const top = this.o.embedded ? b.top + 8 : b.top + 64;
    this.px = railX + railW + 24;
    this.pw = b.right - 24 - this.px;
    this.ptop = top;

    this.buildRail(railX, top, railW);
    this.select(-1);
  }

  private buildRail(x: number, top: number, w: number): void {
    const s = this.scene;
    let y = top;

    // The party Overview tab.
    this.tabs.push({ index: -1, rect: this.tabBg(x, y, w, 30) });
    this.objects.push(
      s.add.text(x + 12, y + 15, "▸ Party", { color: INK.bright, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(43),
    );
    this.hit(x, y, w, 30, () => this.select(-1));
    y += 30 + 8;

    // A divider, then one tab per roster member.
    this.objects.push(s.add.rectangle(x, y - 4, w, 1, COLOR.border).setOrigin(0, 0.5).setDepth(43));

    this.o.data.members.forEach((m, i) => {
      const h = 44;
      this.tabs.push({ index: i, rect: this.tabBg(x, y, w, h) });

      // Role dot + name + level.
      this.objects.push(
        s.add.circle(x + 12, y + 14, 4, roleColor(m.unit, COLOR.border)).setDepth(43),
        s.add
          .text(x + 24, y + 14, m.name, { color: m.alive ? INK.bright : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label })
          .setOrigin(0, 0.5)
          .setDepth(43),
        s.add.text(x + w - 10, y + 14, `Lv${m.level}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(1, 0.5).setDepth(43),
      );

      // A mini HP bar — the glance that makes the rail a readiness strip.
      this.miniHpBar(x + 24, y + 28, w - 48, m);

      // The jeopardy flag.
      const jb = jeopardyBanner(m.jeopardy, m.dyingNights);
      if (jb) this.objects.push(s.add.text(x + w - 10, y + 30, "⚠", { color: jb.color, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(43));

      this.hit(x, y, w, h, () => this.select(i));
      y += h + 6;
    });
  }

  // ---- selection / detail --------------------------------------------------

  private select(index: number): void {
    for (const t of this.tabs) t.rect.setFillStyle(t.index === index ? COLOR.surfaceAlt : COLOR.surfaceRaised);
    this.clear(this.detail);
    this.hideTip();
    this.hidePicker();
    if (index === -1) this.renderOverview();
    else this.renderMember(this.o.data.members[index]);
  }

  private renderOverview(): void {
    const p = this.o.data.party;
    let y = this.ptop + 6;
    y = this.heading("Party Overview", y);

    // Party *vitality* only — the body's own state. Logistics (Storage, Supplies)
    // and gold flow (Upkeep) are single-sourced in the Stores and Ledger tabs, so
    // they no longer mirror here (the Captain's Tent convergence, D58).
    y = this.line(`Morale: ${p.moraleLabel} (${p.morale >= 0 ? "+" : ""}${p.morale})`, y);
    y = this.line(`Rest Points banked: ${p.rp}`, y);
    y += 6;

    // The "how much should we heal" answer.
    const need =
      p.hpDeficit > 0
        ? `Party down ${p.hpDeficit} HP — ${p.woundedCount} wounded`
        : "Party at full health";
    y = this.line(need, y, p.hpDeficit > 0 ? INK.ember : INK.success);
    if (p.jeopardyCount > 0) y = this.line(`${p.jeopardyCount} member(s) in urgent jeopardy — see the ⚠ tabs`, y, INK.danger);
  }

  private renderMember(m: MemberRow): void {
    const s = this.scene;
    const u = m.unit;
    let y = this.ptop + 6;

    // Header (full width): name, then level · class, then the (long) jeopardy line.
    this.detail.push(
      s.add.text(this.px, y, m.name, { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.heading, fontStyle: WEIGHT.bold }).setOrigin(0, 0.5).setDepth(43),
    );
    y += 26;
    y = this.line(`Lv ${m.level} · ${m.jobLabel}`, y, INK.muted);
    const jb = jeopardyBanner(m.jeopardy, m.dyingNights);
    if (jb) y = this.line(jb.text, y, jb.color);
    y += 8;

    // The panel is wide and short, so the card splits into two columns below the
    // header — vitality + stats on the left, jobs + abilities on the right. That
    // keeps an ability-rich card inside its bounds (with room to spare as units grow).
    const colTop = y;
    const px = this.px;
    const pw = this.pw;
    const gap = 18;
    const leftW = Math.round((pw - gap) * 0.54);
    const rightW = pw - gap - leftW;
    const rightX = px + leftW + gap;

    // --- Left column: vitality + stats ---
    this.px = px;
    this.pw = leftW;
    y = colTop;
    this.wideHpBar(px, y, leftW, m);
    y += 14;
    y = this.line(`HP ${m.hp} / ${m.maxHp}`, y);
    // D80: ember once fatigue bites (Weary/Exhausted carry the rest-heal penalty + Deep-Rest gate).
    const fatigueBites = m.fatigueLabel === "Weary" || m.fatigueLabel === "Exhausted";
    y = this.line(`Fatigue: ${m.fatigueLabel} (${m.fatigue})`, y, fatigueBites ? INK.ember : INK.secondary);
    y = this.line(`XP: ${m.xp} / ${m.xpToNext}`, y);
    const pips = statusPips(u);
    if (pips.length) {
      let cx = px;
      this.detail.push(s.add.text(cx, y + 8, "Conditions:", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(43));
      cx += 90;
      for (const pip of pips) {
        const t = s.add.text(cx, y + 8, pip.text, { color: pip.color, fontFamily: FONT.family, fontSize: FONT.label, fontStyle: WEIGHT.bold }).setOrigin(0, 0.5).setDepth(43);
        this.detail.push(t);
        cx += t.width + 10;
      }
      y += 24;
    } else {
      y = this.line("No active conditions", y, INK.disabled);
    }
    y += 4;
    y = this.subheading("Stats", y);
    const stats: [string, number][] = [
      ["Speed", u.speed],
      ["Attack", u.attack],
      ["Defense", u.defense],
      ["Move", u.moveRange],
      ["Sight", u.sightRadius],
      ["Range", u.attackRange],
      ["Awareness", u.awareness],
      ["Intelligence", u.intelligence],
    ];
    const colW = leftW / 2;
    const statTop = y;
    stats.forEach(([label, val], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      this.detail.push(
        s.add.text(px + col * colW, statTop + row * 20, `${label}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(43),
        s.add.text(px + col * colW + colW - 16, statTop + row * 20, `${val}`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(43),
      );
    });
    let leftBottom = statTop + Math.ceil(stats.length / 2) * 20;

    // --- Arms (D77): the three equip slots + worn gear. Interactive when the host
    // wired equip intents; read-only otherwise. The view only calls back + redraws.
    y = leftBottom + 6;
    y = this.subheading("Arms", y);
    if (this.o.onEquip || this.o.onUnequip) {
      this.detail.push(
        s.add.text(this.px, y - 6, "click a slot to equip / swap", { color: INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(43),
      );
      y += 10;
    }
    for (const sv of m.slots) y = this.armsRow(u.id, sv, y);
    leftBottom = y;

    // --- Right column: jobs + abilities ---
    this.px = rightX;
    this.pw = rightW;
    y = colTop;
    y = this.subheading("Jobs", y);
    const jobs = u.heldJobs.length ? u.heldJobs : primaryJobOf(u) ? [primaryJobOf(u)!] : [];
    if (!jobs.length) {
      y = this.line("No job assigned", y, INK.disabled);
    } else {
      for (const jid of jobs) {
        const jl = u.jobLevels[jid]?.level ?? 1;
        const star = jid === primaryJobOf(u) ? " ♛" : "";
        y = this.line(`${getJob(jid)?.name ?? jid}  L${jl}${star}`, y);
      }
      y = this.line(`Loadout slots: ${u.loadoutSlots}`, y, INK.muted);
    }
    y += 6;
    const rightBottom = this.renderAbilities(m, y);

    // A faint divider between the columns, then restore the full-width metrics.
    const colBottom = Math.max(leftBottom, rightBottom);
    this.detail.push(
      s.add.rectangle(px + leftW + gap / 2, colTop, 1, Math.max(0, colBottom - colTop), COLOR.border).setOrigin(0.5, 0).setDepth(42),
    );
    this.px = px;
    this.pw = pw;
  }

  // ---- abilities (hover/focus to read what they do) ------------------------

  private renderAbilities(m: MemberRow, y: number): number {
    if (m.actives.length) {
      y = this.subheading("Active Abilities", y);
      for (const a of m.actives) y = this.abilityRow(a, y, "·");
    }
    if (m.passives.length) {
      y = this.subheading("Passives", y);
      for (const a of m.passives) y = this.abilityRow(a, y, "·");
    }
    if (!m.actives.length && !m.passives.length) y = this.line("No abilities", y, INK.disabled);
    return y;
  }

  /** One ability line: glyph + name on the left, its tag (or unlock level) on the
   *  right, and a hover/click zone that reveals the description tooltip. Locked
   *  actives read dimmed with the level they unlock at. */
  private abilityRow(a: AbilityRow, y: number, glyph: string): number {
    const s = this.scene;
    const rowH = 18;
    const locked = a.lockedUntil !== undefined;

    this.detail.push(
      s.add
        .text(this.px, y, `${glyph} ${a.name}`, {
          color: locked ? INK.disabled : INK.secondary,
          fontFamily: FONT.family,
          fontSize: FONT.label,
        })
        .setOrigin(0, 0.5)
        .setDepth(43),
    );

    const meta = locked ? `Lv ${a.lockedUntil}` : a.tag ?? "";
    if (meta) {
      this.detail.push(
        s.add
          .text(this.px + this.pw, y, meta, {
            color: locked ? INK.ember : INK.muted,
            fontFamily: FONT.family,
            fontSize: FONT.caption,
          })
          .setOrigin(1, 0.5)
          .setDepth(43),
      );
    }

    this.hoverZone(this.px, y - rowH / 2, this.pw, rowH, this.abilityTipText(a));
    return y + rowH;
  }

  /** The multi-line text the tooltip shows for an ability. */
  private abilityTipText(a: AbilityRow): string {
    const head = a.tag ? `${a.name}  ·  ${a.tag}` : a.name;
    const lines = [head, a.description];
    if (a.lockedUntil !== undefined) lines.push(`Locked until Lv ${a.lockedUntil}.`);
    // D80: the projected Fatigue if this unit spends the effort now (e.g. "Effort +4 → Weary").
    if (a.fatigueProjection) lines.push(a.fatigueProjection);
    lines.push(`— ${a.jobName}`);
    return lines.join("\n");
  }

  // ---- Arms (the equip surface, D77) ---------------------------------------

  /**
   * One equip-slot line: label + worn item (or "—" / its mods). When the host wired
   * equip intents, the whole row is a click zone that opens the picker; otherwise it
   * renders read-only. The row reads its data from the projection — never the unit.
   */
  private armsRow(unitId: string, sv: EquipSlotView, y: number): number {
    const s = this.scene;
    const rowH = 20;
    const interactive = !!(this.o.onEquip || this.o.onUnequip);
    const worn = !!sv.itemId;
    const value = worn ? `${sv.itemName}${sv.summary ? ` · ${sv.summary}` : ""}` : "—";

    // Interactive slots read in the accent ink (a clickable affordance); the value
    // gets the full column width (no right-edge hint to collide with in the narrow column).
    const labelColor = interactive ? INK.gold : INK.muted;
    this.detail.push(
      s.add.text(this.px, y, sv.label, { color: labelColor, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(43),
      s.add.text(this.px + 86, y, value, { color: worn ? INK.secondary : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(43),
    );

    if (interactive) {
      const z = s.add.zone(this.px, y - rowH / 2, this.pw, rowH).setOrigin(0, 0).setDepth(45).setInteractive({ useHandCursor: true });
      z.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.showEquipPicker(unitId, sv, y));
      this.detail.push(z);
    }
    return y + rowH;
  }

  /**
   * Open the equip picker for a slot: an **Unequip** (when worn) plus every carried
   * item that fits the slot ({@link DossierProjection.equippables} filtered by slot).
   * Picking a row fires the host intent (`onEquip`/`onUnequip`) — the host applies the
   * core rule and redraws, so this view stays purely intent-out.
   */
  private showEquipPicker(unitId: string, sv: EquipSlotView, anchorY: number): void {
    this.hideTip();
    this.hidePicker();
    const s = this.scene;
    const b = this.o.bounds;
    const pad = 8;
    const headerH = 22;
    const w = 240;

    type Row = { label: string; color: string; onPick: () => void };
    const rows: Row[] = [];
    if (sv.itemId && this.o.onUnequip) {
      rows.push({ label: `↩ Unequip ${sv.itemName}`, color: INK.ember, onPick: () => this.o.onUnequip!(unitId, sv.slot) });
    }
    if (this.o.onEquip) {
      for (const e of this.o.data.equippables.filter((x) => x.slot === sv.slot)) {
        const qty = e.count > 1 ? ` ×${e.count}` : "";
        rows.push({ label: `${e.name}${e.summary ? ` · ${e.summary}` : ""}${qty}`, color: INK.bright, onPick: () => this.o.onEquip!(unitId, e.id) });
      }
    }
    if (rows.length === 0) rows.push({ label: "Nothing carried fits this slot.", color: INK.disabled, onPick: () => this.hidePicker() });

    // Build + measure each row's text, then size and clamp the popup before placing it.
    const texts = rows.map((r) =>
      s.add.text(0, 0, r.label, { color: r.color, fontFamily: FONT.family, fontSize: FONT.label, wordWrap: { width: w - pad * 2 } }).setOrigin(0, 0).setDepth(63),
    );
    const rowHs = texts.map((t) => Math.max(20, t.height) + 6);
    const totalH = pad + headerH + rowHs.reduce((a, h) => a + h, 0) + pad;

    let x = this.px + this.pw + 12;
    if (x + w > b.right - 8) x = b.right - 8 - w;
    x = Math.max(b.left + 8, x);
    let top = anchorY - 10;
    if (top + totalH > b.bottom - 8) top = b.bottom - 8 - totalH;
    top = Math.max(b.top + 8, top);

    this.picker.push(
      s.add.rectangle(x, top, w, totalH, COLOR.surface, 0.99).setOrigin(0, 0).setStrokeStyle(1, COLOR.gold).setDepth(62),
      s.add.text(x + pad, top + pad, sv.label, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0).setDepth(63),
    );
    let ry = top + pad + headerH;
    texts.forEach((t, i) => {
      t.setPosition(x + pad, ry);
      const z = s.add.zone(x, ry - 2, w, rowHs[i]).setOrigin(0, 0).setDepth(64).setInteractive({ useHandCursor: true });
      const pick = rows[i].onPick;
      z.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => { this.hidePicker(); pick(); });
      this.picker.push(t, z);
      ry += rowHs[i];
    });
  }

  private hidePicker(): void {
    for (const o of this.picker) o.destroy();
    this.picker = [];
  }

  // ---- the description tooltip ---------------------------------------------

  /** A hover/focus zone that reveals `text` in the floating tooltip while pointed at. */
  private hoverZone(x: number, y: number, w: number, h: number, text: string): void {
    const z = this.scene.add.zone(x, y, w, h).setOrigin(0, 0).setDepth(46).setInteractive({ useHandCursor: true });
    z.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.showTip(text));
    z.on(Phaser.Input.Events.GAMEOBJECT_POINTER_MOVE, () => this.positionTip());
    z.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.hideTip());
    z.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.showTip(text)); // focus parity (touch)
    this.detail.push(z);
  }

  private showTip(text: string): void {
    this.hideTip();
    const s = this.scene;
    const pad = 8;
    const maxW = 264;
    const txt = s.add
      .text(pad, pad, text, {
        color: INK.bright,
        fontFamily: FONT.family,
        fontSize: FONT.label,
        wordWrap: { width: maxW - pad * 2 },
        lineSpacing: 3,
      })
      .setOrigin(0, 0);
    const bg = s.add
      .rectangle(0, 0, txt.width + pad * 2, txt.height + pad * 2, COLOR.surface, 0.98)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLOR.gold);
    this.tip = s.add.container(0, 0, [bg, txt]).setDepth(60);
    this.positionTip();
  }

  private positionTip(): void {
    if (!this.tip) return;
    const b = this.o.bounds;
    const p = this.scene.input.activePointer;
    const bg = this.tip.list[0] as Phaser.GameObjects.Rectangle;
    let x = p.x + 16;
    let y = p.y + 16;
    if (x + bg.width > b.right - 8) x = p.x - bg.width - 16;
    if (y + bg.height > b.bottom - 8) y = b.bottom - 8 - bg.height;
    this.tip.setPosition(Math.max(b.left + 8, x), Math.max(b.top + 8, y));
  }

  private hideTip(): void {
    this.tip?.destroy();
    this.tip = undefined;
  }

  // ---- small drawing helpers ----------------------------------------------

  private heading(text: string, y: number): number {
    this.detail.push(
      this.scene.add.text(this.px, y, text, { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.heading, fontStyle: WEIGHT.bold }).setOrigin(0, 0.5).setDepth(43),
    );
    return y + 30;
  }

  private subheading(text: string, y: number): number {
    this.detail.push(this.scene.add.text(this.px, y, text, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(43));
    return y + 22;
  }

  private line(text: string, y: number, color: string = INK.secondary): number {
    this.detail.push(this.scene.add.text(this.px, y, text, { color, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(43));
    return y + 20;
  }

  private wideHpBar(x: number, y: number, w: number, m: MemberRow): void {
    const s = this.scene;
    this.detail.push(
      s.add.rectangle(x, y, w, 8, COLOR.surfaceRaised).setOrigin(0, 0.5).setStrokeStyle(1, COLOR.border).setDepth(43),
      s.add.rectangle(x, y, Math.max(0, w * m.hpFrac), 8, hpColor(m.hpFrac)).setOrigin(0, 0.5).setDepth(44),
    );
  }

  private miniHpBar(x: number, y: number, w: number, m: MemberRow): void {
    const s = this.scene;
    this.objects.push(
      s.add.rectangle(x, y, w, 4, COLOR.surfaceRaised).setOrigin(0, 0.5).setDepth(43),
      s.add.rectangle(x, y, Math.max(0, w * m.hpFrac), 4, hpColor(m.hpFrac)).setOrigin(0, 0.5).setDepth(44),
    );
  }

  private tabBg(x: number, y: number, w: number, h: number): Phaser.GameObjects.Rectangle {
    const rect = this.scene.add.rectangle(x, y, w, h, COLOR.surfaceRaised).setOrigin(0, 0).setStrokeStyle(1, COLOR.border).setDepth(42);
    this.objects.push(rect);
    return rect;
  }

  /** An invisible interactive hit-rect over a tab (kept above its content). */
  private hit(x: number, y: number, w: number, h: number, onClick: () => void): void {
    const z = this.scene.add.zone(x, y, w, h).setOrigin(0, 0).setDepth(45).setInteractive({ useHandCursor: true });
    z.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
    this.objects.push(z);
  }

  private clear(list: Phaser.GameObjects.GameObject[]): void {
    for (const o of list) o.destroy();
    list.length = 0;
  }
}
