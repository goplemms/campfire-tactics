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
  type DossierProjection,
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

  constructor(scene: Phaser.Scene, o: DossierViewOptions) {
    this.scene = scene;
    this.o = o;
    this.build();
  }

  destroy(): void {
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
    let y = this.ptop + 6;

    // Name + class line.
    this.detail.push(
      s.add.text(this.px, y, m.name, { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.heading, fontStyle: WEIGHT.bold }).setOrigin(0, 0.5).setDepth(43),
    );
    y += 26;
    y = this.line(`Lv ${m.level} · ${m.jobLabel}`, y, INK.muted);
    y += 8;

    // Vitality: a wide HP bar + numbers.
    this.wideHpBar(this.px, y, this.pw, m);
    y += 14;
    this.detail.push(
      s.add.text(this.px, y, `HP ${m.hp} / ${m.maxHp}`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(43),
    );
    y += 22;

    // Jeopardy banner (urgent risks).
    const jb = jeopardyBanner(m.jeopardy, m.dyingNights);
    if (jb) y = this.line(jb.text, y, jb.color);

    // Readiness: fatigue + XP progress.
    y = this.line(`Fatigue: ${m.fatigueLabel} (${m.fatigue})`, y, m.fatigue > 6 ? INK.ember : INK.secondary);
    y = this.line(`XP: ${m.xp} / ${m.xpToNext}`, y);
    y += 6;

    // Conditions.
    const pips = statusPips(m.unit);
    if (pips.length) {
      let cx = this.px;
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
    y += 6;

    // The combat stat block, in two columns.
    y = this.subheading("Stats", y);
    const u = m.unit;
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
    const colW = this.pw / 2;
    const rowY = y;
    stats.forEach(([label, val], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      this.detail.push(
        s.add
          .text(this.px + col * colW, rowY + row * 20, `${label}`, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label })
          .setOrigin(0, 0.5)
          .setDepth(43),
        s.add
          .text(this.px + col * colW + colW - 24, rowY + row * 20, `${val}`, { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.label })
          .setOrigin(1, 0.5)
          .setDepth(43),
      );
    });
    y = rowY + Math.ceil(stats.length / 2) * 20 + 8;

    // Jobs held + their levels (growth detail).
    y = this.subheading("Jobs", y);
    const jobs = u.heldJobs.length ? u.heldJobs : primaryJobOf(u) ? [primaryJobOf(u)!] : [];
    if (!jobs.length) {
      this.line("No job assigned", y, INK.disabled);
    } else {
      for (const jid of jobs) {
        const jl = u.jobLevels[jid]?.level ?? 1;
        const star = jid === primaryJobOf(u) ? " ♛" : "";
        y = this.line(`${getJob(jid)?.name ?? jid}  L${jl}${star}`, y);
      }
      this.line(`Loadout slots: ${u.loadoutSlots}`, y, INK.muted);
    }
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
