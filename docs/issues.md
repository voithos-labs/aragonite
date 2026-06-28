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

### Search-reveal of a far match can strand the viewport on the wrong block (off-window, async-undecoded content)

**Severity:** minor (viewport-follow only — find still counts/highlights the match; navigation lands the scroll, not the caret)
**Files:** `src/lib/reactivity/list-windowing.svelte.ts` (`revealChild`), `src/lib/reactivity/publish-ref.svelte.ts` (`revealChildOrWait`), `src/lib/components/Editor.svelte` (`reveal`/`revealPath`)

Navigating search to an off-window match (e.g. Previous-button to the last match in the showcase) sometimes scrolls to a _different_ block (a table) instead of the match's block. Root cause is two-layered: (a) `revealChild` does one scroll to the target's _estimated_ offset, which lands short when the intervening band is under-estimated, so `revealChildOrWait` degrades and the follow-up `scrollIntoView` no-ops (block unmounted); (b) — the dominant cause in the showcase — the freshly-revealed band's **images haven't decoded**, so they measure ~0, the document height shrinks, and the browser clamps `scrollTop` back up, sliding the window off the target. Layer (a) on its own self-heals via the existing `correctAnchor` forward-compensation when the doc _grows_ on measure (verified: a `<br>`-heavy under-estimated fixture reveals on-screen with the single scroll), so a `revealChild` re-scroll loop was explored and reverted as it changed no observable end-state. Layer (b) is the real fix.

**Why deferred:** layer (b) is the same off-window / async re-measure class as the windowed-table-overlay issue above — the fix is reserving image height pre-decode + re-asserting the reveal once the band settles, i.e. the shared decoration/re-measure layer. Fold into that work.

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
