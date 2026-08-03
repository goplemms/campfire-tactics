# Spinoff idea: structural layout linter — pitch, monetization, and why it broke

**Status:** challenged, did NOT survive in its original form. Kept for the salvage.
**Date:** 2026-08-03
**Scope:** this is a *product/business* note about spinning tooling out of this repo.
It is not game canon and nothing in `docs/design/` depends on it.

---

## 1. The original pitch

Extract the geometric linter from `npm run audit:visual` (`scripts/visual-audit.mjs`)
into a general-purpose Playwright package for web apps.

The claim, in one line:

> The `audit:visual` geometric linter is a general technique, extractable in a weekend
> into a Playwright package, and differentiated from pixel-diff visual testing by being
> *structural* — it asserts invariants rather than comparing images.

The differentiation argument: Percy / Chromatic / Applitools do **pixel diffs**, which
need baselines, break on every intentional change, and can't say *why* something is
wrong. A structural linter needs no baseline and works on a brand-new page.

## 2. The monetization model (this part still stands on its own)

Open-core + a paid GitHub App.

**Free tier** — `npm install -D <pkg>`, MIT, a Playwright fixture. Runs locally and in
anyone's CI, forever, no account. Not crippleware: it *is* the distribution channel.

**Paid tier** — only things that are *naturally* hosted, never a gated rule:

| Paid feature | Why it can't live in the npm package |
| --- | --- |
| Inline PR review comments | Needs a GitHub App identity + webhook receiver |
| "3 new defects vs `main`" | Needs the base branch's results stored |
| Trend history | Needs a database |
| Org-wide suppression rules | Genuinely better as server-side policy than a committed file |

**Key architecture decision — invert who runs the browser.** Do *not* clone and build the
customer's app (needs their secrets, env, private deps; cost scales with usage). Instead
their existing CI runs the free package with an upload reporter, which POSTs JSON to you;
your server writes a GitHub Checks API run with annotations. Codecov / Chromatic / Danger
all work this way. Infra becomes a JSON endpoint + a database, you never touch their
source, and cost per customer is ~zero. That last property is the whole reason it could
qualify as passive.

**Billing:** GitHub Marketplace (they process payment + discovery, they take a cut —
verify current terms) vs Stripe direct (own the customer, no discovery). Common play is
Stripe for money, marketplace listing for discovery.

**Pricing shape:** free for public repos (every OSS PR then shows a check run with your
name on it — that's the growth loop), ~$10–15/mo private repo, ~$50–100/mo org.

**Funnel math** (ballpark, *not* measured — flagged as unverified below):
`10k npm installs → ~1–3% create an account → ~10–20% of those pay → ~25 paying
→ ~$600/mo at ~$25 avg`. Realistically a year+ to reach 10k installs.

---

## 3. The challenge — what actually broke

Tested against the real code rather than argued. **The "weekend extraction" claim is
falsified.**

`lintScene` (`scripts/visual-audit.mjs:199`) does not measure a rendered page. It walks
the **Phaser scene graph**:

| Line | What it reads | DOM equivalent |
| --- | --- | --- |
| `:202` | `game.scene.getScenes(true)` | — no such thing |
| `:249` | `o.type === "Text"` | text lives in text *nodes*, not typed objects |
| `:211` | `o.parentContainer` chain for effective alpha | `getComputedStyle` up the tree + `visibility` / `display` / `content-visibility` |
| `:220` | `layerDepth` — outermost ancestor's `.depth` | **CSS stacking contexts** |
| `:253` | `o.getBounds()` — axis-aligned, reliable | `getBoundingClientRect()`, but see (2) below |
| `:45` | fixed `800×600` canvas | scrolling + responsive breakpoints |

The algorithm is ~200 lines and the ideas are sound. **The measurement layer is 100% of
the work and none of it transfers.** Worse, the DOM version is not a port — it is
strictly harder, in five ways Phaser exempted us from by construction:

1. **Nesting makes overlap meaningless.** `texts` is a flat list of discrete objects. In
   DOM a `<div>` overlaps its child `<span>` by 100% of the smaller box — every
   parent/child pair trips rule (2) at `:322`. The naive port fires on every page ever
   written. Needs ancestor–descendant exclusion, which the scene graph never forced.
2. **Element rects aren't text ink.** A block element's rect is full-width regardless of
   glyph position. Two centered headings in stacked full-width divs "overlap" constantly.
   Needs `Range.getClientRects()` — a different measurement primitive.
3. **`layerDepth` has no CSS equivalent.** `:220` works because Phaser depth is one number
   on one ancestor chain. CSS paint order is stacking contexts × `z-index` × `position` ×
   `opacity` × `transform` × `will-change`. The entire `occluded` / `scrimmedApart`
   false-positive suppression — the cleverest thing in the file — rests on that one number.
4. **`overflow: hidden` is a missing category.** Content spilling its parent is *clipped*,
   not off-canvas. Rule (1) at `:305` has no notion of it; Phaser doesn't clip by default.
5. **Scroll.** "Off-canvas" is decidable at `800×600`. On a scrolling responsive page it
   isn't a question with an answer.

### Two further objections (raised, not yet tested)

- **The absence is evidence.** If this were tractable and valuable it would exist; the
  Playwright ecosystem is not short of ambitious people. `axe-core` already ships contrast
  and `target-size` — i.e. rules (3) and (4) below are commoditized and free. The rules
  that remain are exactly the hard ones above. That explains the gap better than "nobody
  thought of it."
- **Shipped layout bugs are content-dependent.** The linter runs on seeded demo state.
  Real bugs come from the 40-character username, the German translation, the empty list.
  A linter on dev fixtures is structurally blind to the failure class customers care about.
  *(Possible counter: pair it with content fuzzing — but that is far past a weekend.)*

### Load-bearing assumptions

| Assumption | Status |
| --- | --- |
| The linter is environment-agnostic | ❌ **Falsified** — Phaser-graph-native throughout |
| False-positive suppression is the hard part | ✅ Confirmed — `scrimmedApart` (`:290`) is that lesson already learned |
| A weekend of work | ❌ **Falsified** — CSS stacking alone is not a weekend |
| Structural ≠ pixel-diff is a real distinction | ⚠️ True but much narrower than pitched |
| 10k installs → ~$600/mo | ⚠️ Unverified, probably optimistic |
| Teams without design review will pay for design quality | ⚠️ Unverified — and they may be exactly the teams with no budget |

### Diagnosis: right for the wrong reason

`audit:visual` is genuinely excellent — but *because Phaser hands you a flat display list
of discrete text objects with axis-aligned bounds and a single integer depth, on a fixed
canvas with no CSS, no scroll, no breakpoints.* The output quality belongs to the
**environment**, not the technique. The original pitch generalized from a case where every
hard part was absent.

---

## 4. What survives

The transferable asset is **not** the linter. It is the **coverage gate + specificity
matrix**: `scripts/visual-audit-challenge.mjs` (68 lines), which proves each `expect`
predicate is true on its own screen and false on every other.

The insight it encodes — *a screenshot can be geometry-clean and still show the wrong
screen, so a visual check needs a proof that it looked at the right thing* — is
environment-agnostic, and appears in no commercial visual-testing product.

Immediate re-challenge: **that is too small to be a business.** It's a blog post and a
~100-line helper, not a GitHub App. Which likely makes it *marketing* for something else
rather than the product itself.

---

## 5. Open threads to poke at

- [ ] Does the ancestor–descendant exclusion problem (1) have a clean general solution, or
      is it per-design-system tuning forever? This decides whether a DOM version is
      *possible* or merely *hard*.
- [ ] Is there a narrower framing where the environment stays friendly? E.g. scoped to
      **canvas/WebGL apps** (Phaser, PixiJS, Three.js) where the scene-graph assumption
      genuinely holds — smaller market, but the code mostly already exists.
- [ ] Could the coverage-gate idea be the wedge into an existing tool (a Playwright
      plugin, a Chromatic add-on) rather than a standalone product?
- [ ] Content fuzzing (long strings, empty states, i18n) as the *actual* product, with
      geometry checks as the assertion layer — does that flip the value prop?
- [ ] Verify the funnel numbers against a real comparable (Danger JS, `size-limit`,
      Knip — public download counts vs known revenue).

## 6. Not yet challenged

Idea #2 from the same session — an **SEC EDGAR-backed point-in-time stock screener**
built on `ds-stock-screener` (auth seam, entitlements, and deploy pipeline already built).
Expected load-bearing assumptions: that EDGAR XBRL is genuinely redistributable, and that
point-in-time correctness is a retail selling point rather than an institutional one.
Neither has been verified.
