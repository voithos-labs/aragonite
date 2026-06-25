# Known Issues

Log of known editor issues. Each entry carries severity, affected files, a description,
reproduction (where relevant), and either a **Target** version (if scheduled via the roadmap)
or a **Why deferred** rationale (if not). Remove entries when shipped.

## Decoration & rendering

### Search-match (and selection) highlights don't re-measure off-window rows of a windowed table

**Severity:** minor (giant tables only)
**Files:** `src/lib/components/MatchOverlay.svelte`, `src/lib/components/SelectionOverlay.svelte`, `src/lib/components/blocks/table/TableBlock.svelte`

In a table large enough to activate row windowing, rows outside the viewport aren't mounted, so a search match (or selection) in an off-window row paints no highlight. The table's only re-measure scroll listener is its internal horizontal scroller, so scrolling that row into view doesn't repaint it either. Find still counts the match and Replace All still fixes it (replace reparses the whole table subtree) — only the highlight is affected. Normal-sized tables are fully covered.

**Why deferred:** pre-existing gap shared with cross-block selection highlighting; the real fix is a shared vertical-scroll/mount re-measure for windowed container overlays (a shared decoration/re-measure layer), gated by VR e2e + perf. Aligns with the roadmap's selection coordinate-addressing plugin hooks.

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

## Selection

### Cross-block extend doesn't scroll an off-window focus endpoint into view (non-table blocks)

**Severity:** minor (viewport-follow only — the selection is correct, no data loss)
**Files:** `src/lib/selection/keyboard-extend.ts` (`scrollFocusBlockIntoView`), `src/lib/selection/cross-block/keydown.ts`, `src/lib/selection/shared-keydown.ts`

When a Shift+Arrow cross-block extension lands focus on an off-window (windowed-out) prose block, that block stays unmounted, so the user can't see where the selection now ends. `scrollFocusBlockIntoView` resolves the focus via `getBlockElByPath`, which returns null for an unmounted block, so the scroll silently no-ops. Only table endpoints get revealed (the table branch drives `revealPath`).

Editor-root keystroke **routing** is in place — focus parks on the `.editor` root on unmount and a document-level listener routes the next cross-block / undo-redo keystroke — so undo/redo is not inert when the caret's block is windowed out. What remains is the off-window **reveal during a cross-block extend**: re-enabling it breaks the collapse for deep-nested list focus (where `ListBlock` bypasses `BlockList` windowing), because the reveal unmounts the block holding native focus before the collapse can route.

The selection core itself is window-independent: across a very large document the selection data, clipboard copy (both ends), and per-block overlay painting are all correct, and the highlight follows the viewport on scroll. This viewport-follow residual is the only concern.

**Fix direction:** make the deep-nested reveal during an extend settle through `ListBlock`'s own windowing before the collapse routes. Needs a focused debug-engine session.

**Why deferred:** viewport-follow polish only; the routing/undo-inert fix already shipped. Interacts with `ListBlock`'s bypass of `BlockList` windowing.
