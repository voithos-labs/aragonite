# Known Issues

Log of known editor issues. Each entry carries severity, affected files, a description,
reproduction (where relevant), and either a **Target** version (if scheduled via the roadmap)
or a **Why deferred** rationale (if not). Remove entries when shipped.

## Decoration & rendering

### HTML entities render as the literal source instead of the decoded character

**Severity:** minor (rendering; deviates from author intent)
**Files:** `src/lib/core/inline-render.ts` (`entityReference` rendering); spec at `docs/design/editor/inline-parsing.md` § Rendering.

Per the inline-parsing spec, an `entityReference` node renders as a span holding the literal source (`&copy;`, `&mdash;`, `&#39;`). The `decoded` field — the Unicode character the entity resolves to — is parsed but never displayed. This was a deliberate application of the "always-visible styled source" principle, but for entities it's questionable: unlike emphasis (markers _around_ styled content), an entity reference IS the entire markup — there's no separable content to style. A user typing `&copy;` to show © sees `&copy;` and is surprised; most editors (Obsidian, GitHub, VS Code preview) display the decoded glyph.

**Fix direction:** render the decoded character in a `contenteditable=false` atomic span, with offset translation between display textContent (1 char) and raw (`&...;` length) — analogous to the `ambient/` prefix translation but applied to inline mid-content. Round-trip already preserves the source via `node.raw`.

**Target:** the inline-widget path is now fully general — the editing registry shipped (0.9.10), caret-addressing keys generically off `[data-inline-widget]`/`data-source-*`, and a decoded-entity widget could ship as a component via the portal seam (0.9.14). What remains is building the entity widget itself plus re-adding the trimmed `deleteGranularity`/`onEdge` policy fields (see the freeze-forward entry below) — entity editing is defined by atomic delete, which image's select-then-delete model doesn't cover.

### Table cell Shift+Enter inserts `<br>` but renders it as literal text

**Severity:** minor (table cells only)
**Files:** `src/lib/components/blocks/table/` (cell inline rendering)

Shift+Enter inside a cell inserts a literal `<br>` at the cursor — the correct GFM representation, since cells can't carry raw newlines, and round-trip preserves the `<br>` bytes. But the cell displays it as literal text; a rendered line break depends on a follow-up migration that routes cell content through the same widget-aware inline pipeline as prose.

**Why deferred:** the byte-level behavior is correct (round-trip safe); only the in-cell rendering lags. Folds into the cell-inline-render migration.

## Code structure

### Whole-table keyboard reorder (Alt+↑/↓) is unavailable

**Severity:** minor (a11y; table blocks only)
**Files:** `src/lib/components/blocks/table/cell-keydown-plan.ts`, `src/lib/schema/block-kind-descriptor.ts` (`table` registration), `src/lib/components/blocks/table/TableBlock.svelte`

Alt+↑/↓ now reorders fencedCode, thematicBreak, paragraphs, and list items among their siblings via the `block.moveUp/moveDown` keymap, matching the drag handle's tooltip. A table has no non-cell focus surface, and inside a cell Alt+↑/↓ is already bound — in `cell-keydown-plan.ts`'s hard-coded `SHORTCUTS` — to ROW reorder, so there is no free gesture to reorder the whole table block, and its drag handle's keyboard equivalent is missing.

**Why deferred:** the table's structural chords live in a second, hard-coded dispatch (`cell-keydown-plan.ts`) instead of the declarative `keymap` the other kinds use, so they also bypass the consumer `keybindings` override prop. Expressing a whole-table `block.moveUp/moveDown` cleanly is part of migrating the table chords onto the declarative keymap — its own deliberate change (the consumer-guide's rebindability promise should be scoped or fulfilled with it). Code and thematic-break keyboard reorder shipped; the table case is flagged here.

### Table-branch range-delete ceremony lacks the chrome branch's hardening

**Severity:** minor (latent; benign only because cascade deletes solely empty containers)
**Files:** `src/lib/selection/range-delete-table.ts` vs `range-delete-chrome.ts`

The chrome branch filters deletion candidates to subtree roots and identity-gates each delete; the table branch splices nested covered paths child-by-child and cascades over pre-deletion paths. Unify on the chrome branch's ceremony on the next pass over this file.

### MatchOverlay's cell branch still scans all matches

**Severity:** minor (perf; search-open only)
**Files:** `src/lib/components/MatchOverlay.svelte` (grid/table branch)

The prose branch now reads its own per-path bucket from the match index; the table-cell branch still walks the full match list because its cell addressing needs a seam the overlay doesn't have. Extend the bucket read to cells when that seam is next touched.

### Mermaid reference plugin is excluded from the consumer example (by design)

**Severity:** n/a — recorded exclusion, not a defect
**Files:** `src/routes/test/plugins/mermaid/`; `examples/consumer/` (no mermaid route)

The mermaid dogfood's synced sources typecheck against the packed tarball (boundary proven),
but no consumer route ships it — the `mermaid` engine is a heavy devDependency the consumer
example's CI budget doesn't justify. The render-primary recipe in the plugin guide is the
durable record. Re-fold if the consumer example ever gains a budget-insensitive smoke tier.

### Render-primary wall ledger: focus seam, command→component bridge

**Severity:** minor (authoring friction; each additive)
**Files:** `src/routes/test/plugins/mermaid/` (the consumer that surfaced them); `docs/editor/plugin-guide.md` § render-primary recipe

Two walls the reference build recorded, each a 1.2 candidate (the ledger's fence-matcher and
`normalizeLineEndings` items shipped as `aragonite/plugin` re-exports): (1) a childless opaque
container dead-ends the factory's caret traversal with no public focus-actions seam — the
reference block ships `focusable: false`; the editable-leaf tier (shipped 0.9.16) is the escape
for blocks that adopt a native source view, but a container that stays render-only still has no
focus seam; (2) block commands have no component channel, so view-state commands need a
plugin-owned node→component bridge every render-primary plugin will rebuild. Also minor: the
container shim hardcodes `editable: true`.

## Test coverage

### Attribution perf axes time out on 1MB setSource settle (pre-existing)

**Severity:** minor (diagnostic instruments only — the `PERF-GATE` rows and typing-latency rows pass with 2-3× headroom, so `perf:check`'s regression gate is intact)
**Files:** `src/lib/e2e/tests/perf/attribution.perf.spec.ts`

9 of 13 attribution axes fail on `page.waitForFunction` (60s) waiting for `settle()` after `__test.setSource` of a 1MB fixture. Proven pre-existing: axis1 fails identically at 0.9.7 (`d7135f3`), so this is not a 0.9.8 regression. The failure means the in-page document never reaches the expected byte length within the timeout — diagnose the settle predicate against current `setSource` behavior on 1MB fixtures before trusting any attribution numbers.

**Why deferred:** baseline-proven pre-existing; the diagnosis belongs to a perf-harness pass, not the conformance/registry batch that surfaced it.

### Two latent fail-loud conformance divergences the corpus cannot spell

**Severity:** trivial (phantom-red prevention notes, not defects)
**Files:** `src/lib/test/conformance/normalize.ts`, `src/lib/core/inline/character-refs.ts`

Two divergence shapes are unreachable by the current corpus alphabets but would surface as fail-loud fresh divergences if the corpus ever gains the needed bytes: (1) an entity-decoded newline after a space (`foo &#10;bar`) — our softbreak trimming keys on `\n` bytes regardless of provenance; (2) C1 numeric references (`&#128;`) — the reference applies HTML5's cp1252 remap while we follow CommonMark §2.5's letter (ours spec-correct, probe-verified). If either surfaces, class it as deliberate with these rationales rather than chasing it as a scanner bug.

**Why deferred:** unreachable today; recorded so a future corpus widening inherits the adjudications.

### Invariant-watcher fixture has no per-tag allow/require; first opt-out consumer asserts inline

**Severity:** trivial (test-fixture affordance)
**Files:** `src/lib/e2e/tests/plugins/plugins-prop-staggered.spec.ts` (the opt-out consumer); the invariant-watcher fixture

The staggered-mount spec expects exactly one `invariant:late-opener-registration` fire, but the
watcher fixture is a boolean with no per-tag allowlist — so the spec opts out and asserts the
fire itself. Sound for one consumer (a local `poll(...).toBe(1)` requires the warn, which an
allowlist would let vanish silently); on a second opt-out consumer, promote per-tag
require/allow into the fixture per the choke-point rule.

### No composition-driving harness; IME guards are pinned by parity, not by tests

**Severity:** minor (test gap)
**Files:** `src/lib/components/blocks/code/CodeBlock.svelte`, `src/lib/components/blocks/text/` (composition handlers)

The `insertLineBreak` composition gate (and the IME rules generally) can't be exercised — neither the unit harness nor Playwright drives `compositionstart`/`compositionend` sequences today. A minimal composition harness (synthetic composition events at the handler level, or CDP IME simulation) would let the IME contract be pinned directly instead of by analogy to sibling guards.

### LaTeX acceptance-axis follow-ups (A2 integration gap, A1 flakiness watch)

**Severity:** minor (test coverage)
**Files:** `src/lib/e2e/tests/plugins/latex-acceptance.spec.ts`; block-math component (`src/routes/test/plugins/latex/BlockMath.svelte`)

Two gaps left by the LaTeX acceptance suite:

- **A2 proven by construction, not end-to-end.** "Edit one of N live equations re-renders only that
  one" is asserted for the memo primitive at the unit level. For block math it rests on a per-instance
  memo plus Svelte reactivity — proven by construction, not by a live edit-one-of-N integration test.
- **A1 fixture may cross the windowing watermark.** The block-reveal fixture is large enough that
  folding a block can trigger a geometry re-estimate, a flakiness watch-point for the seeded multi-run.
  Read an A1 failure there as a windowing-geometry interaction before a reveal regression.

**Why deferred:** each acceptance axis already maps to a falsifiable test; these close residual
coverage when the LaTeX test surface is next extended.

## Plugin containers

### A plugin rebinding chrome Enter to block.split leaves a dead undo entry

**Severity:** trivial (plugin misuse; unreachable via seam defaults)
**Files:** `src/lib/editor-actions/plugin/chrome-leaf.ts` (chrome keymap), `src/lib/editor-actions/block-edit-core.ts` (`split`)

The chrome keymap binds Enter to `chrome.descendToBody` by default. A plugin that rebinds it to `block.split` gets a noop split — the chrome is single-line, so nothing structurally changes — through a commit that still pushes an undo entry.

**Why deferred:** reachable only by a plugin overriding the documented single-line chrome contract; not worth a guard until a real consumer needs `block.split` on chrome.

### Cross-block copy STARTING mid-chrome loses the container wrapper

**Severity:** minor (clipboard fidelity; container kind lost on paste)
**Files:** `src/lib/selection/clipboard-text.ts` (`collectCrossBlockText`)

The closer-synthesis fix covers a copy whose END lands mid-chrome (title/summary): it
synthesizes a chrome-only container and reparses to the same kind with an empty body. The
mirror direction — a copy that STARTS mid-chrome and extends into the body (and possibly past
the container) — is a distinct class the synthetic-chrome-only design cannot serve. The chrome
tail emits wrapper-less and the selected body is collected flat, so no opener or closer wraps
it. Repro: `collectCrossBlockText` from `:::note Ti|tle` into the body below yields
`"tle\nBody1\n\nBody2\n\nBel"`, which reparses to three bare paragraphs — the `note` kind gone.

**Fix direction:** a chrome-only synthetic node is semantically wrong here (empty body would
strand the selected body as top-level blocks after the container). Faithful bytes need the
chrome tail emitted as the container opener AND a synthesized closer injected where the walk
exits the container — a `collectCrossBlockText` structural change (container-exit tracking),
not the bounded closer-synthesis the END case uses.

**Why deferred:** the END direction is the shipped, reachable-today gesture. Fold the START
direction into the post-1.0 clipboard/hook generalization with the container-exit walk change.

### Directive rebuild normalizes CRLF line ends to `\n`

**Severity:** minor
**Files:** `src/lib/core/directive/grammar.ts` (`serializeDirective`)

`serializeDirective` hardcodes `\n` for the opener and closer line ends, so a post-EDIT rebuild of
a CRLF-authored directive normalizes those chrome lines to `\n`. Parse→serialize stays CRLF-safe —
an opaque container emits its `raw` verbatim — so only a rebuild (triggered by a structural edit)
normalizes. Shared with the callout/details precedent, whose chrome rebuild does the same.

**Fix direction:** thread the authored line ending through metadata (as the container already
threads its colon counts) so the rebuild reproduces CRLF.

**Why deferred:** the byte round-trip holds without edits, and this matches the existing
container-chrome rebuild behavior; fold into a line-ending-fidelity pass.

## Plugin inline widgets

### Inline-widget source editing (reveal) is unwired in table cells

**Severity:** minor (parity gap; cells render widgets but cannot edit them)
**Files:** `src/lib/components/blocks/table/TableCellBlock.svelte`,
`src/lib/components/blocks/table/cell-render.ts` vs
`src/lib/components/blocks/text/widget-interaction.ts` (the prose seam)

Cells gained widget rendering/pooling in 0.9.14 (`createSvelteWidgetPool`) but never wired
`createWidgetInteraction`: no click-to-reveal, no Enter-reveal, no blur commit, and no
containment-scoped fold. Verified on the `mathtable` seed — clicking a cell's inline `$x^2$`
widget leaves it rendered; source editing is simply unavailable inside cells. Distinct from
the reveal collapse/switch fix (which lives at the TextEditableBlock choke point and covers
every reveal-source kind there); wiring cells means threading the same interaction bundle
through the cell surface, picking up the `document.activeElement` pending-cursor guard
already flagged in "TableCellBlock has an unguarded pending-cursor effect".

**Why deferred:** cell reveal is a feature wire-up, not a regression; fold into the
cell-inline-render migration alongside the existing cell entries.

### Re-add `deleteGranularity` / `onEdge` when the inline-entity consumer lands

**Severity:** n/a — freeze-forward reminder, not a defect
**Files:** `src/lib/core/inline/inline-widgets.ts` (`InlineWidgetEditingPolicy`), re-exported on
`aragonite/plugin`

Two fields were trimmed from the public `InlineWidgetEditingPolicy` (commit `fe99476`) because nothing
consumed them, keeping the pre-freeze inline surface free of inert configuration. They must be re-added
**additively** when the deferred inline-entity / atomic-inline feature lands — entity editing is
_defined by_ delete granularity (atomic `&copy;` delete versus image's select-then-delete), so building
it forces the re-add. The exact trimmed shape, recorded so the re-add restores it verbatim:

- `deleteGranularity: 'atomic' | 'select-then-delete'`
- `onEdge: 'select' | 'step-over'`

**Why deferred:** freezing inert fields and later giving them behavior is the one path that breaks an
author's config; trimming now and re-adding with the consumer is the additive-safe choice.

### TableCellBlock has an unguarded pending-cursor effect (latent reveal-source parity)

**Severity:** trivial (latent; unreachable today)
**Files:** `src/lib/components/blocks/table/TableCellBlock.svelte` vs
`src/lib/components/blocks/text/TextEditableBlock.svelte`

`TextEditableBlock` gained a `document.activeElement === el` guard on its pending-cursor `$effect`
during the inline-widget feature, and `CodeBlock` gained it when multi-block content commits made
a structural split reachable from a code edit (0.9.16). The analogous effect in `TableCellBlock`
is still unguarded — unreachable today: cell edits are context-dependent-kind (never structural)
and no source-reveal is wired to cells, so no blur-commit sets a pending cursor while focus has
left.

**Fix direction:** add the same `document.activeElement === el` guard if the cell surface ever
gains inline-widget reveal.

**Why deferred:** no reachable bug; mirror the guard when reveal reaches the cell surface.
