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

**Why deferred:** a pure refactor with no functional gain and real divergences; do it as its own commit gated on the full row + column + windowed + wide-table drag e2e. Clean seam: one `startTableReorderDrag(down, { process, axis, getScrollContainer, setLine, commit, fromIdx, onDragRecognized, lifetimeSignal })`, with the row/column files reduced to geometry + `process`.

### Delete-enablement predicates have a third inline copy in the selection layer

**Severity:** minor (single-source-of-truth; byte-equivalent today)
**Files:** `src/lib/editor-actions/table-context.ts` (`canDeleteRow`/`canDeleteColumn`), `src/lib/selection/range-delete-table-coverage.ts`

The action menu and the commit wrappers now share `canDeleteRow`/`canDeleteColumn`, but `selection/range-delete-table-coverage.ts` still re-derives the same refusal rules inline. Byte-equivalent today; a future change to the rules could drift the selection-layer copy.

**Why deferred:** `selection/` may not import `editor-actions/`, so a true three-way unification needs the predicates relocated down to `tree-operations/table-mutations.ts` (the layer all three import) plus a selection range-delete e2e re-run — a deliberate cross-layer move.

## Test coverage

### Dragging a body row into the header region has no direct e2e

**Severity:** trivial (test gap)
**Files:** `src/lib/e2e/tests/blocks/table/drag-reorder-row.spec.ts`

Row drag clamps a body row to `[1, rowCount-1]` (it can't displace the fixed header). The clamp is enforced in code and exercised indirectly by the upward-drag test, but no test drags a row into the gap above the header and asserts it lands at row 1.

**Why deferred:** low marginal value and the precise into-header gesture is flaky to drive; add when convenient.

## Virtual rendering

### Collapsing a Ctrl+Shift+End list selection to start lands the caret in the wrong item

**Severity:** minor (caret placement; pre-existing, not from the table work)
**Files:** `src/lib/e2e/tests/perf/virtual-rendering.spec.ts:516` (failing test); cross-block selection collapse-to-start path

After Ctrl+Shift+End selects to the end of a long (windowed) list, collapsing to start lands the caret in the focus item rather than the anchor item — a marker typed at "start" appears in the wrong list item. The e2e fails on `main` (`6a4bb54`) as well, so it predates and is unrelated to the table-affordances work.

**Why deferred:** needs its own investigation of the collapse-to-start path under windowing; surfaced while running the table-affordances gate.

## Documentation

### gfm-reference still calls non-http autolink schemes "roadmapped"

**Severity:** trivial (stale doc)
**Files:** `docs/editor/gfm-reference.md` (~line 98)

The reference says angle-bracket autolinks for non-http schemes are roadmapped, but they shipped in 0.9.0.

**Why deferred:** out of scope of the table-affordances work; a one-line correction whenever docs are next touched.
