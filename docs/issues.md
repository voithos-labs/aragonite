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

## Tables

### Cross-block whole-row-snap delete leaves the table's row ids stale

**Severity:** minor (dev-audit-visible; no known user-facing repro)
**Files:** `src/lib/selection/cross-block/ops.ts` (scope collection), table row `BlockListState`

A cross-block delete whose whole-row snap removes table rows splices `table.children` without the table itself being a commit scope (`collectTouchedContainers` collects only strict ancestors of the endpoints), so `auditBlockListStateConsistency` reports the table's `ids` length stale against its children/refs. Reproducible on the plain editor with no plugin involved (paragraph → body-cell Delete). The Gate-6 chrome×table e2e audits exclude table-kind state for this reason.

**Why deferred:** pre-existing and independent of the chrome wall; surfaced while testing the wall × table composition. Fixing it means teaching the cross-block commit to scope endpoint tables — a deliberate commit-machinery change to make under the table e2e battery, not a drive-by.

## Plugin containers

### Collapsed title-only descend mints an invisible body paragraph

**Severity:** minor (latent; unreachable until a collapsible container ships)
**Files:** `src/lib/editor-actions/block-edit-core.ts` (`descendToBody`)

`descendToBody`'s mint branch (chrome is the only child) commits an empty body paragraph plus an undo entry unconditionally — unlike the focus-move branch, it is not gated on the body slot being mountable. In a collapsed (`{#if open}`) title-only container, Enter in the title would mint an invisible empty paragraph and a dead undo entry.

**Why deferred:** no collapsible container exists yet, so the branch cannot be reached. Design the mountability gate alongside the details cycle's collapse model.

### A plugin rebinding chrome Enter to block.split leaves a dead undo entry

**Severity:** trivial (plugin misuse; unreachable via seam defaults)
**Files:** `src/lib/editor-actions/plugin-chrome-leaf.ts` (chrome keymap), `src/lib/editor-actions/block-edit-core.ts` (`split`)

The chrome keymap binds Enter to `chrome.descendToBody` by default. A plugin that rebinds it to `block.split` gets a noop split — the chrome is single-line, so nothing structurally changes — through a commit that still pushes an undo entry.

**Why deferred:** reachable only by a plugin overriding the documented single-line chrome contract; not worth a guard until a real consumer needs `block.split` on chrome.

### Undo-restore e2e has a latent read window under CPU load

**Severity:** trivial (CI-flake awareness; passes in isolation and every clean run)
**Files:** `src/lib/e2e/tests/plugins/reserved-chrome-selection.spec.ts` (Gate 1 undo-restore)

The Gate-1 undo-restore e2e once observed `readNote` seeing a childless note after `waitForSourceContains` had already passed, under concurrent CPU load — the source-bytes wait won the race a beat before the CST children re-materialized. It passed in isolation and in every clean run since.

**Why deferred:** a non-deterministic read window under CPU contention, not a product bug, with no reliable repro. Awareness only; revisit if it recurs in CI.

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

## Test coverage

### Dragging a body row into the header region has no direct e2e

**Severity:** trivial (test gap)
**Files:** `src/lib/e2e/tests/blocks/table/drag-reorder-row.spec.ts`

Row drag clamps a body row to `[1, rowCount-1]` (it can't displace the fixed header). The clamp is enforced in code and exercised indirectly by the upward-drag test, but no test drags a row into the gap above the header and asserts it lands at row 1.

**Why deferred:** low marginal value and the precise into-header gesture is flaky to drive; add when convenient.

## Virtual rendering

### Top-level `revealPath` does not drop a stale off-window block ref

**Severity:** minor (latent; no known user-facing repro today)
**Files:** `src/lib/components/Editor.svelte` (`revealPath`)

The container `revealByPath` and `TableBlock` both gate their reveal on `isStale`/`dropRef`, because a child scrolled off-window can leave a stale ref in its slot (`publishRefSlot`'s cleanup is conditional, by design — it errs toward not-clearing to avoid stomping a sibling's just-written slot). The top-level `revealPath` (`Editor.svelte`) passes `isInWindow` but not `isStale`/`dropRef`. If a top-level block's slot went stale, the reveal would skip the scroll: a leaf target degrades to no-caret, but a stale top-level _container_ target would descend into a detached ref and could hang the editor — the same class as the now-fixed list collapse-to-start.

The fix is the same two lines already applied to the container shim (`dropRef: (i) => { blockRefs[i] = undefined; }` and `isStale: (i) => !topWindowing.isInWindow(i)`); `dropRef` is already optional on `RevealChildOptions`, so no signature change is needed.

**Why deferred:** the staleness is a non-deterministic cleanup race. A multi-top-block windowed repro (small list at index 0, then thousands of paragraphs, collapse-to-start after scrolling block 0 off-window) confirms the top-level block does unmount, but its slot cleared correctly every run — the race that leaves a stale slot reproduces reliably only in the inner list scope. So a trustworthy regression guard is the blocker, not the fix. Needs a deterministic way to force a stale top-level slot before the two-line fix lands with a guard.

## Documentation

### gfm-reference still calls non-http autolink schemes "roadmapped"

**Severity:** trivial (stale doc)
**Files:** `docs/editor/gfm-reference.md` (~line 98)

The reference says angle-bracket autolinks for non-http schemes are roadmapped, but they shipped in 0.9.0.

**Why deferred:** out of scope of the table-affordances work; a one-line correction whenever docs are next touched.
