# Code Review Findings — forge-review (full audit, 2026-06-24)

Full four-pass forge-review of `src/lib/` plus a UI/UX flow axis, run on `main` at v0.9.1.
Every recorded finding was verified against the actual source before listing here; agent
false positives that were investigated and rejected are logged at the end so the analysis
isn't re-run later.

Severity: **Critical** = correctness/data-loss · **Important** = wrong-in-some-path, stale
docs that mislead, public-API issue, tests that don't guard a feature · **Minor** =
narrow/defensive/cosmetic.

Status legend: `[ ]` open · `[x]` fixed · `[?]` needs owner decision.

---

## Theme 1 — Structural-edit staleness after copy-on-write

The commit ceremony leaves the pre-mutation node object unmutated (the undo snapshot
shares it); any `afterTick` callback that reads a post-mutation count/metadata through a
reference captured _before_ the commit reads a stale value.

- [ ] **Important — `editor-actions/table-context.ts:201,203` (`deleteRow` afterTick).**
      `node` is destructured from `deps` at line 183 (before the commit). `afterTick` reads
      `node.children?.length` and `metadataOf(node, 'table').columnCount` from that stale
      reference, so `targetRow = Math.min(rowIdx, newRowCount - 1)` uses the _pre-delete_ count.
      Deleting the last body row → `focusCell` targets a non-existent row (focus lost, or a
      throw if `focusCell` doesn't guard). Fix: read through `deps.node` in `afterTick`.
- [ ] **Important — `editor-actions/table-context.ts:219` (`deleteColumn` afterTick).** Same
      pattern: `metadataOf(node, 'table').columnCount` from the stale capture → off-by-one /
      non-existent column focus when deleting the last column. Fix: `deps.node`.
      _(Contrast: `insertRow`/`moveRow` afterTicks use pre-computed indices and are correct.)_

## Theme 2 — Ordered-list renumber inconsistency on paste break-out

- [ ] **Important — `tree-operations/paste/list-break-out.ts:183,198-199`.**
      `buildListBreakOutReplacement` calls `assembleListHalf(list, firstHalfItems, 1)` —
      hardcoding the first half's start number to `1` — and computes the second half from
      `firstHalfItems.length + 1`. Both ignore the list's actual base. Pasting a mismatched
      list into the middle of an ordered list that starts at e.g. `3.` renumbers both halves
      from `1`, changing the user's markers. The sibling operation `list/exit-replacement.ts:69`
      does this correctly via `orderedBaseOf(items[0])`. Fix: capture `base = orderedBaseOf(items[0])`;
      first half uses `base`, second half uses `base + firstHalfItems.length`. (Oddball Solution
      / Inconsistent behavior between two sibling list operations.)

## Theme 3 — Atomic-widget handling assumes "image"

- [ ] **Minor — `components/blocks/text/widget-interaction.ts:286`.** `widgetExtensionTarget`
      filters `if (inline.kind !== 'image') continue`, while every sibling in the file
      (`widgetAtCursor`, `findFirstEdgeWidget`, `findLastEdgeWidget`) uses `isInlineWidget`.
      Shift+Arrow extension into a non-image atomic widget (raw-HTML `<br>`, allowlisted inline
      HTML) isn't intercepted → native selection collapse instead of widget-select. The
      documented edge-widget-select behavior (editor.md § Atomic inline widgets) is generic, not
      image-specific. Fix: use `isInlineWidget(inline, deps.node.raw)`.

## Theme 4 — Minor correctness / defensive gaps

- [ ] **Minor — `editor-actions/unwrap-strategies.ts:74`.** `deps.parent.focus.moveFocus(index - 1, 'end')`
      is not awaited, while every sibling branch awaits. `moveFocus` awaits `revealPath`, so in a
      windowed document focus can race the reveal. Fix: `await`.
- [ ] **Minor — `selection/range-delete-table.ts` (`survivingAnchorCellCaret`, ~line 313).**
      When `anchorRow === 0` the function computes `survivorRow = -1` and reads
      `table.children[-1].children[...]` → `TypeError`. Not currently reachable (callers always
      pass `endCellIdx = totalCellCount`, so `deleteCellsAndCollapse` returns `'tableEmpty'`
      first), but the precondition is undocumented and unguarded. Fix: guard `anchorRow === 0`.
- [x] **Not a bug — `selection/widget-range-paint.ts:68-76` (`safeIntersects` fallback).**
      Two agents flagged the `compareBoundaryPoints` fallback as inverted, but re-verifying against
      the WHATWG DOM spec shows `range.compareBoundaryPoints(END_TO_START, nodeRange)` compares
      _range.start_ to _nodeRange.end_ (not range.end to node.start), so the original
      `(END_TO_START <= 0) && (START_TO_END >= 0)` is the correct inclusive intersection test. The
      variable names match. Left unchanged — "fixing" it would have broken it.
- [ ] **Minor — `cursor/sticky-measure.ts:22`.** Guard `rects[0].width >= 0 || rects[0].height > 0`
      is always true (`DOMRect.width` is never negative), defeating the intended 0×0
      `getBoundingClientRect` fallback. Sibling helpers (`getOffsetRect`, `visual-lines.getRangeTop`)
      use `rects[0].height > 0`. Fix: match them.
- [ ] **Minor — `cursor/widget-offset.ts:112`.** The `exact` fallback branch is unreachable by
      construction (every site that sets `exact` immediately returns it). Dead-code clarity only;
      remove or comment as a deliberate defensive no-op.

## Theme 5 — Branding leaks after the Limestone→aragonite extraction

The README's "the limestone app is its first consumer" is legitimate. These are stale
_branding_ tokens that leak the old app name, one of them in the **public API**.

- [?] **Important — `src/lib/styles/editor-theme.css:5,12,26,97` — public CSS class
  `.limestone-editor-theme`.** Consumers are told to put this class on their chrome
  (`docs/editor/consumer-guide.md`), so it's a shipped public symbol carrying the old brand.
  Renaming is a public-API change that also touches the downstream limestone app + the demo
  harness (`src/app.css:13`, `src/routes/test/editor/theme.ts:3-4`, `+page.svelte:75`).
  **Owner decision needed** (rename now / dual-class alias / defer to 1.0).
- [?] **Minor — `src/routes/test/editor/debug-panel/panel-state.svelte.ts:1`.** localStorage key
  `'limestone.debug-panel.state.v1'` (referenced by `e2e/tests/debug-panel.spec.ts:16`).
  Demo-only; rename alongside the decision above.
- [ ] **Minor — `docs/code-style.md:3`, `docs/commit-conventions.md:3`.** Say "Limestone-specific"
      where they mean aragonite-specific. Pure doc pointers; safe to fix.
      _(Test fixtures using "# Limestone" as document content are harmless and intentionally left.)_

## Theme 6 — Stale docs / doc-code drift

- [ ] **Important — `docs/testing.md:256`.** `import { dumpTree, dumpSelection } from '$lib/editor/debug/inspect';`
      — the `/editor/` segment is limestone-era layout. Aragonite has no `src/lib/editor/`; the
      module is `src/lib/debug/inspect.ts`. Correct path: `$lib/debug/inspect`.
- [ ] **Important — `docs/design/editor/editor.md:5`.** Goal still reads "A block-based markdown
      editor for Limestone…", framing the editor as Limestone's internal tool. Every other doc
      treats limestone as a downstream consumer. Reframe to the extracted-library framing.
- [ ] **Minor — `CLAUDE.md` module-layout table.** Omits `debug/` (`src/lib/debug/`:
      `dump-tree.ts`, `inspect.ts`, `operations-log.ts`), which is active and tested.
- [ ] **Minor — comment signal-to-noise.** `core/inline/inline-cache.ts` header narrates the
      implementation (forge-style "what-comment" antipattern); past-version comments in
      `test/round-trip.test.ts:212`, `test/core/inline/links-reference.test.ts:127`,
      `e2e/tests/perf/typing-latency.perf.spec.ts:24-32` ("0.6.7 …", "0.6.4 behavior preserved").
      Trim to the load-bearing why.

## Theme 7 — Organization (forge-style §7)

The tree is overall healthy: no shelf dirs (`utils/`/`helpers/`/`managers/`); `html-entities.ts`
(2136 lines) is a generated lookup table, not sprawl; `Editor.svelte`/`TextEditableBlock.svelte`/
`TableCellBlock.svelte`/`CodeBlock.svelte` are thin wiring shells (pure logic already extracted
to factories). Findings:

- [?] **Important — §7 Diagnostic 2 (who depends on whom): `undo/` ↔ `selection/` type cycle.**
  `undo/types.ts:7` imports `EditorSelection` from `selection/primitives`; `selection/range-delete.ts:10`
  and `range-delete-table.ts:10` import `SharingState` from `undo/epoch-tracker` (as do
  `tree-operations/{node-ops,unshare,structural-change,reorder}.ts` and `editor-actions/{deps,block-edit-scope}.ts`).
  Type-only (erased at runtime, so no runtime cycle), but it prevents either directory from being
  read/tested independently. Both are pure value types. Options: relocate `EditorSelection` and/or
  `SharingState` to a stable shared leaf; or document the type-only cycle as acceptable. **Owner
  decision** (this DAG was designed deliberately — don't churn it without sign-off).
- [ ] **Minor — §7 Diagnostic 2: inconsistent subdir grouping in `editor-actions/`.**
      `editor-actions/undo/` is a subdir, but the four `nested-*.ts` files (a cohesive nested-actions
      cluster) are flat siblings. Move them to `editor-actions/nested/` to match the `undo/` precedent.
- [ ] **Minor — §7 Diagnostic 3: `selection/reorder-drag.ts` cohesion stretch.** Block-reorder
      pointer-drag lives in `selection/` (text-selection machinery) though its only domain dependency
      is `editor-actions/reorder-action.ts`. Mitigated by its header comment. Consider relocating
      near `reorder-action.ts`.

## Theme 8 — Testing coverage gaps (would these catch a regression?)

- [ ] **Important — no test for delete-last-row / delete-last-column focus landing.**
      `e2e/tests/blocks/table/shortcuts.spec.ts` delete tests assert only source mutation, not focus,
      and delete a _non-last_ row. The Theme-1 bug (focus on a non-existent cell — possibly a throw)
      passes silently. Add: 2-body-row table → delete 2nd body row → assert `toBeFocused()` on a valid
      cell; symmetric for columns.
- [ ] **Important — no test for paste break-out into a non-1-based ordered list.** All break-out
      E2E uses unordered or 1-based ordered ancestors. `buildListBreakOutReplacement` (pure, exported)
      has zero direct unit tests. Add a unit test: ordered list starting at `3.`, break-out paste,
      assert first half retains `3.`.
- [ ] **Minor — no test for Shift+Arrow into a non-image inline widget** (Theme 3). Mirror the
      image `widget-range-paint.spec.ts` pattern for a raw-HTML `<br>` widget.
- [~] **`safeIntersects` fallback** (Theme 4) — moot: re-verified as correct, not inverted. A
  test stubbing `Range.intersectsNode` away remains nice-to-have but low value.

## Theme 9 — UI/UX flows (user-flagged: search & find/replace)

### Clear-cut (fix)

- [ ] **A1 — search doesn't reveal the first match; Enter skips it.** `rescan()`
      (`reactivity/search-state.svelte.ts:32-43`) sets `matches`/`activeIndex=0` but never reveals,
      so after typing the active match (shown "1 / N") may be off-screen; the first `Enter`→`next()`
      advances to index 1, skipping match 0 until wrap. Fix: reveal the active match after `rescan`
      on query/option change (incremental-find), keeping Enter = next.
- [ ] **A3 — Enter in the Replace input is a dead key.** The Replace input
      (`SearchBar.svelte:115-121`) has no `onkeydown` and is in no `<form>`. Fix: add a handler
      (Enter → `replaceCurrent`, Esc → `close`).
- [ ] **A4 — "Replace All" success is indistinguishable from "no matches".** After `replaceAll`,
      `rescan` empties `matches` → the count renders "No results" (`SearchBar.svelte:87-89`). Fix:
      surface a transient "N replaced" message.
- [ ] **A5 — Esc loses the caret.** `close()`→`onClose` focuses the editor root; the prior
      selection isn't snapshotted/restored (`search-state.svelte.ts:75-79`, `Editor.svelte` onClose).
      Fix: snapshot the selection on open, restore on close.
- [ ] **A6 — image resize overlay doesn't reposition when switching directly between two images.**
      `syncOverlayToWidget.update()` (`components/image/image-edit-commit.ts:193-228`) only re-runs on
      `edit`/`resize`/`load`/`error` + ResizeObserver — not on a selection change; the enclosing
      `$effect` (`ImageOverlayHost.svelte:64`) doesn't read the selection, so A→B switch leaves the
      resize-handle box on A until the next edit. Fix: trigger `update()` on widget-selection change
      (or key the overlay div on selection identity, as the properties popover already does at :89).
- [ ] **A2 — next/prev doesn't scroll a mounted-but-offscreen match.** `revealPath`→
      `revealChildOrWait` only scrolls when the target block is _unmounted_ (windowed out); a match in
      a mounted-but-scrolled-out block updates count+highlight without scrolling. Fix: after reveal
      resolves, `scrollIntoView({block:'nearest'})` on the active match's block. _(Touches reveal
      logic — verify against windowing.)_

### Needs owner decision

- [?] **B1 — search bar is a floating top-right overlay** (`SearchBar.svelte:132-145`, no
  `max-width`) that can cover top-right content/matches. Float (compact) vs dock (no overlap,
  costs vertical space)? Recommendation: keep floating, ensure A1/A2 scroll the match clear of
  the bar.
- [?] **B2 — reorder discoverability.** Drag handle is hover-only + `aria-hidden`
  (`BlockDragHandle.svelte`); Alt+↑/↓ keyboard reorder has no in-product hint. Persistent faint
  handle? tooltip? docs-only?
- [?] **B3 — table row/col ops are keyboard-only** (zero `<button>`/aria in
  `components/blocks/table/`). Add hover insert/delete affordances, or keep keyboard-only +
  document the chords?

---

## False positives investigated and rejected (do not re-flag)

- **`core/parsers/html-block.ts:101-110`** — correct. Scanning from `startIndex` handles
  single-line HTML blocks (`<!DOCTYPE html>` opens+closes on one line → consume that line).
- **`core/parsers/list.ts:68-69`** — correct. `i = j + 1` advances past blanks _and_ the content
  line; `joinRaw(itemStartIndex, i)` includes the blanks, so round-trip is preserved.
- **`core/inline/emphasis.ts:276-277`** — correct. Marker offsets are read _before_ the
  `opener.end -= consume` / `closer.start += consume` mutations at 289-292 (standard CommonMark).
- **`components/image/ImageOverlayHost.svelte:64`** — not the claimed bug. `syncOverlayToWidget`
  invokes `getOverlay()` _synchronously_ during the effect, so Svelte 5 tracks `imageOverlayEl`
  and the effect re-runs when it binds. (The real overlay issue is A6, a different mechanism.)
- **`components/blocks/table/TableCellBlock.svelte:467` (onCopy)** — not a bug.
  `writeCrossBlockCopy` calls `e.preventDefault()` itself (`selection/cross-block/clipboard.ts:22`);
  the fall-through to native copy for intra-cell selections is intentional and documented.
- **`components/blocks/list/ListItemBlock.svelte:135` (isEmptyItem)** — not data-loss.
  `exitListAtItem`→`buildExitReplacement` _relocates_ trailing children; the shallow check is
  deliberate per the in-code comment.

---

## Resolution (2026-06-24)

Worked through to completion this pass (commits on `main`). This section is the authoritative
status; inline `[ ]` boxes above may lag.

### Fixed + committed

- **Theme 1** — table-context `deleteRow`/`deleteColumn` afterTick now read through `deps.node`
  (the post-commit node), not the stale pre-commit capture.
- **Theme 2** — `buildListBreakOutReplacement` captures `orderedBaseOf(items[0])` and numbers
  both halves from it; **regression test added** (`test/tree-operations/paste/list-break-out.test.ts`).
- **Theme 3** — `widgetExtensionTarget` uses `isInlineWidget` (covers non-image atomic widgets).
- **Theme 4** — `unwrap-strategies.ts:74` `moveFocus` awaited; `survivingAnchorCellCaret` guards
  `anchorRow === 0`; `sticky-measure.ts` guard changed to `rects[0].height > 0`.
- **Theme 5 / 6** — `.limestone-editor-theme` → `.aragonite-editor-theme` (hard rename across
  CSS/docs/demo + the `aragonite.debug-panel.state.v1` storage key & its e2e ref); `testing.md`
  debug import path; `editor.md` library framing; `CLAUDE.md` `debug/` row; `code-style.md` /
  `commit-conventions.md` naming; `inline-cache.ts` comment trimmed.
- **Theme 9 (UI/UX clear-cut)** — A1 reveal active match on type; A2 scroll mounted-but-offscreen
  match; A3 Enter in replace input; A4 "N replaced" feedback; A5 restore caret on close; A6 image
  overlay repositions on widget switch. **B1** search bar kept floating (owner). **B2** reorder
  drag-handle tooltip added. **B3** keyboard-shortcuts section added to the consumer guide
  (table hover affordances stay roadmapped).

Verified: `npm run check` 0 errors · `npm run test:editor` 2393 pass / 1 skip · `npm run lint`
clean · `e2e-search` 23/23 · `e2e-blocks/image` 84/84 · full `npm run test:e2e` run post-fix.

### Not a bug (re-verified, unchanged)

`safeIntersects` (Theme 4) and the six entries under "False positives" above.

### Deferred — recommendations (no code change; need owner sign-off / are roadmapped)

- **Theme 4** `cursor/widget-offset.ts:112` unreachable `exact` fallback — cosmetic dead-code.
- **Theme 7** `undo/` ↔ `selection/` **type-only** cycle — erased at runtime; the clean fix
  (relocate `EditorSelection` + `SharingState` to a shared leaf) touches ~10 import sites. Left
  unchanged to avoid churning the deliberate DAG without sign-off.
- **Theme 7** move `editor-actions/nested-*.ts` → `editor-actions/nested/`; relocate
  `selection/reorder-drag.ts` beside `reorder-action.ts` (minor org).
- **Theme 8** add e2e for delete-last-row/col focus landing (guards Theme 1) and Shift+Arrow into
  a non-image widget (guards Theme 3).
- **B3** table hover insert/delete affordances (owner: roadmapped after the table-row drag handle).
