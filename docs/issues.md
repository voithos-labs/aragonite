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

**Target:** 1.2 — the inline-widget editing registry's first consumer (`docs/roadmap.md` § 1.2). Decoded rendering is prototyped; entity keyboard interaction (edge-delete, arrow step-over, shift-extend) needs the registry's atomic-inline caret-addressing, currently hardcoded to `kind === 'image'`.

### Table cell Shift+Enter inserts `<br>` but renders it as literal text

**Severity:** minor (table cells only)
**Files:** `src/lib/components/blocks/table/` (cell inline rendering)

Shift+Enter inside a cell inserts a literal `<br>` at the cursor — the correct GFM representation, since cells can't carry raw newlines, and round-trip preserves the `<br>` bytes. But the cell displays it as literal text; a rendered line break depends on a follow-up migration that routes cell content through the same widget-aware inline pipeline as prose.

**Why deferred:** the byte-level behavior is correct (round-trip safe); only the in-cell rendering lags. Folds into the cell-inline-render migration.

## Code structure

### Table reorder-drag lifecycle is duplicated across the row and column controllers

**Severity:** minor (structure; no behavior impact)
**Files:** `src/lib/components/blocks/table/table-reorder-drag.ts`

`startRowReorderDrag` and `startColumnReorderDrag` are ~98-line near-identical controllers — teardown / commit-on-release / pointermove / pointerup / cancel / key handling and listener registration are byte-identical; only the per-axis `process()`, the axis, and the insertion-line shape differ. The cross-block `editor-actions/reorder-drag.ts` is a third drag controller but diverges enough (delegated capture-phase install, ghost label, no drag threshold) that folding it in would leak.

**Why deferred:** a pure refactor with no functional gain and real divergences; do it as its own commit gated on the full row + column + windowed + wide-table drag e2e. Clean seam (validated against the live code by the 2026-07 review, with two amendments): `process` must RETURN `{ line, dropTo }` rather than mutate closure state — which also makes the axis clamps pure-testable — and the `axis` param is only the autoscroll axis (name it `autoScrollAxis`). The header-clamp now has a direct controller-level unit test (`table-reorder-drag-clamp.test.ts`), so the refactor's clamp behavior is pinned in advance. A `pointerId` filter on `onUp` (both controllers commit on any pointerup today) is a real fix to land as its own guarded change, not silently inside the refactor.

### Whole-table keyboard reorder (Alt+↑/↓) is unavailable

**Severity:** minor (a11y; table blocks only)
**Files:** `src/lib/components/blocks/table/cell-keydown-plan.ts`, `src/lib/schema/block-kind-descriptor.ts` (`table` registration), `src/lib/components/blocks/table/TableBlock.svelte`

Alt+↑/↓ now reorders fencedCode, thematicBreak, paragraphs, and list items among their siblings via the `block.moveUp/moveDown` keymap, matching the drag handle's tooltip. A table has no non-cell focus surface, and inside a cell Alt+↑/↓ is already bound — in `cell-keydown-plan.ts`'s hard-coded `SHORTCUTS` — to ROW reorder, so there is no free gesture to reorder the whole table block, and its drag handle's keyboard equivalent is missing.

**Why deferred:** the table's structural chords live in a second, hard-coded dispatch (`cell-keydown-plan.ts`) instead of the declarative `keymap` the other kinds use — the S1 single-source gap. Expressing a whole-table `block.moveUp/moveDown` cleanly (a distinct chord, or routing the block-level chord through the cell plan's `native` fallthrough) is part of that keymap migration, a Tier-3 concern out of this batch's scope. Code and thematic-break keyboard reorder shipped; the table case is flagged here.

### Delete-enablement predicates have a third inline copy in the selection layer

**Severity:** minor (single-source-of-truth; byte-equivalent today)
**Files:** `src/lib/editor-actions/table-context.ts` (`canDeleteRow`/`canDeleteColumn`), `src/lib/selection/range-delete-table-coverage.ts`

The action menu and the commit wrappers now share `canDeleteRow`/`canDeleteColumn`, but `selection/range-delete-table-coverage.ts` still re-derives the same refusal rules inline. Byte-equivalent today; a future change to the rules could drift the selection-layer copy.

**Why deferred:** `selection/` may not import `editor-actions/`, so a true three-way unification needs the predicates relocated down to `tree-operations/table-mutations.ts` (the layer all three import) plus a selection range-delete e2e re-run — a deliberate cross-layer move.

## Paste

### Ordered-into-ordered container-match paste does not renumber

**Severity:** minor (rendering interop; round-trip safe)
**Files:** `src/lib/tree-operations/paste/container-match.ts`

The sibling-absorb route renumbers pasted ordered items from the splice point, and (since 0.9.6) both routes normalize unordered bullet glyphs — but container-match splices ordered items into a matching ordered ancestor with their pasted numbers intact (`1. 2. 3.` lands mid-list unchanged). Bytes round-trip; reference renderers re-sequence from the first number, so display order is right but the source numbering is misleading.

**Why deferred:** pre-existing, unspecified behavior surfaced while closing the unordered-glyph gap; renumbering here should reuse `renumberOrderedList` under the same precompute-before-splice discipline, gated on the container-paste unit family — a small standalone change.

## Tables & selection (review 2026-07 minors)

### Right-click destroys an intra-table rectangle selection before the menu opens

**Severity:** minor (triple-path parity: menu Cut/Copy structurally can't act on the rectangle keyboard copy handles)
**Files:** `src/lib/components/blocks/table/TableCellBlock.svelte` (`onPointerDown`)

`onPointerDown` runs for any button and clears cross-block state (which encodes the intra-table rectangle) before `contextmenu` opens the menu, so the menu captures a collapsed selection. Fix: skip the clear (and drag-listener install) when `e.button === 2`, letting `openCellMenu` capture the rectangle payload.

### Keyboard intra-cell Copy and Cut write different payloads

**Severity:** minor (copy→paste silently drops widget bytes that cut→paste round-trips)
**Files:** `src/lib/components/blocks/table/TableCellBlock.svelte` (`onCopy` vs `onCut`)

`onCut`'s intra-cell arm writes the raw slice (preserves `<br>`); `onCopy` falls through to the browser default (rendered textContent — widgets contribute nothing). Give `onCopy` the same raw-slice arm, or fold into the cell-inline-render/clipboard migration.

### Table-branch range-delete ceremony lacks the chrome branch's hardening

**Severity:** minor (latent; benign only because cascade deletes solely empty containers)
**Files:** `src/lib/selection/range-delete-table.ts` vs `range-delete-chrome.ts`

The chrome branch filters deletion candidates to subtree roots and identity-gates each delete; the table branch splices nested covered paths child-by-child and cascades over pre-deletion paths. Unify on the chrome branch's ceremony on the next pass over this file.

### Column width floors are not invalidated by a column reorder

**Severity:** cosmetic
**Files:** `src/lib/components/blocks/table/TableBlock.svelte` (measure epoch)

The monotonic per-track floors reset on `${columnCount}:${widthVersion}`; a reorder changes neither, so a wide column's old track keeps its floor until an unrelated change. Fold a structure token into the epoch or permute the floors with the commit.

## Interaction & a11y (review 2026-07 minors)

### Table action menu has no viewport edge clamping and no accessible name

**Severity:** minor (a11y)
**Files:** `src/lib/components/blocks/table/TableActionMenu.svelte`

Fixed-position at raw coords — near the right/bottom edge part of the menu renders off-screen unreachably; `role="menu"` carries no `aria-label`. Clamp x/y against the viewport after mount; add `aria-label="Table actions"`.

### CodeBlock's `insertLineBreak` beforeinput commits before the composition guard

**Severity:** minor (IME parity)
**Files:** `src/lib/components/blocks/code/CodeBlock.svelte` (`onBeforeInput`)

An IME emitting `insertLineBreak` mid-composition would sync during composition, against the design's IME rule. Gate the branch on `!composing` (its mobile-Enter purpose applies post-compositionend, when `composing` is already false).

### Drag-handle enablement snapshots the context getter at mount

**Severity:** minor (runtime prop toggle only)
**Files:** `src/lib/components/BlockHost.svelte`, `src/lib/components/blocks/list/ListItemBlock.svelte`

Both invoke the live `blockDragHandles` getter once into a `const`; toggling the prop at runtime yields mixed handles as blocks window in and out. Read the getter inside a `$derived`.

### MatchOverlay re-scans every document match per mounted overlay per scroll

**Severity:** minor (search-open only; degrades scroll on match-heavy docs)
**Files:** `src/lib/components/MatchOverlay.svelte`, `src/lib/reactivity/search-state.svelte.ts`

Each overlay's scroll-driven measure iterates ALL matches. Build one `Map<pathKey, Match[]>` per rescan so each overlay measures only its own.

## Undo/commit (review 2026-07 minors)

### No-op undo re-marks the tree shared; history swap drops the pending input event

**Severity:** minor (perf + op-log undercount; no aliasing risk)
**Files:** `src/lib/editor-actions/commit/history.ts`, `commit/text-batch.ts`

`requestUndo/Redo` capture state (marking the whole tree shared) before checking the stack is non-empty — a no-op Ctrl+Z forces needless copy-on-write spines. `beginHistorySwap` discards the pending keystroke batch without emitting its `input` event; `interrupt()` (flush) serves the stale-timer concern equally.

### `commitMultiScope` rollback restores children but not published ids/refs

**Severity:** minor (narrow post-publish throw window; DEV re-throws anyway)
**Files:** `src/lib/editor-actions/commit/undo-controller.ts`

A throw after the publish loop leaves top-level `blockIds`/refs reflecting the rolled-back mutation until the next commit. Snapshot ids/refs per `PreparedScope` and restore them in the rollback thunk.

### Blockquote single-child exit's parent split is fire-and-forget

**Severity:** trivial
**Files:** `src/lib/editor-actions/blockquote-overrides.ts`

One branch awaits `parentBlockEdit.splitBlock`, the sibling doesn't; no caller sequences after it today. Await it for symmetry when next touched.

## Documentation duplication (review 2026-07 minors)

### Consumer-guide duplicates chord table and ceremony map; typography constants triplicated

**Severity:** minor (drift risk)
**Files:** `docs/editor/consumer-guide.md` (keyboard table; mutation-ceremony map), `src/lib/components/Editor.svelte` + `src/lib/cursor/visual-lines.ts` + `src/lib/styles/editor.css` (line-height/char-width estimate constants)

The hand-listed ~25 chords and the ceremony prose duplicate registry/design-doc content with no coherence check; the windowing estimate constants mirror CSS typography in two TS files. Options: a lint-tier test asserting each documented chord resolves in a registry; trim the ceremony map to a link; derive or co-locate the typography fallbacks.

## Test coverage (review 2026-07 minors)

### details-reveal negative asserts race the fire-and-forget reveal

**Severity:** minor (pre==post check — a buggy auto-expand landing one tick late would be missed)
**Files:** `src/lib/e2e/tests/plugins/details-reveal.spec.ts` (degrade asserts)

`bodyHostCount === 1` and `aria-expanded=false` hold before the reveal attempt too. Interpose a bounded settle (2× render flush or a short stability poll) before the negative asserts.

### `waitForTimeout`-then-assert races async reveals in three specs

**Severity:** minor (contention flakes; the wait proves nothing)
**Files:** `src/lib/e2e/tests/selection/extend-offwindow-endpoint.spec.ts`, `src/lib/e2e/tests/search/reveal-past-undecoded-images.spec.ts`, `src/lib/e2e/tests/search/offwindow-table-overlay.spec.ts`

Fixed waits (150–400ms) precede positive asserts on reveal/paint state. Replace with `page.waitForFunction`/`expect.poll` on the asserted condition itself.

## Plugin containers

### A plugin rebinding chrome Enter to block.split leaves a dead undo entry

**Severity:** trivial (plugin misuse; unreachable via seam defaults)
**Files:** `src/lib/editor-actions/plugin-chrome-leaf.ts` (chrome keymap), `src/lib/editor-actions/block-edit-core.ts` (`split`)

The chrome keymap binds Enter to `chrome.descendToBody` by default. A plugin that rebinds it to `block.split` gets a noop split — the chrome is single-line, so nothing structurally changes — through a commit that still pushes an undo entry.

**Why deferred:** reachable only by a plugin overriding the documented single-line chrome contract; not worth a guard until a real consumer needs `block.split` on chrome.

### Undo-restore e2e read window is an idiom class, not a one-off

**Severity:** trivial (CI-flake awareness; passes in isolation and every clean run)
**Files:** the reserved-chrome spec family (`src/lib/e2e/tests/plugins/reserved-chrome-*.spec.ts`), undo epilogues

The Gate-1 undo-restore e2e once observed `readNote` seeing a childless note after `waitForSourceContains` had already passed under CPU load — the source-bytes wait won the race a beat before the CST children re-materialized. The 2026-07 review traced the same `waitForSourceContains`-then-read-children idiom to ~10 undo epilogues across the (since split) reserved-chrome specs — all latent under contention. Fix idiom when touched: poll the CST shape (children count/kind via the live-CST probes), not the source bytes.

**Why deferred:** non-deterministic under contention only, no clean-run repro; convert the epilogues to CST-shape polls on the next touch of each spec rather than as a sweep.

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

**Why deferred:** out of the Task-6 descope-hatched bound; the END direction is the shipped,
reachable-today gesture. Fold the START direction into the 1.2 clipboard/hook family with the
container-exit walk change.
