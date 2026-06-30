# Feature: Virtual rendering (top-level windowing)

A document whose estimated height clears the activation watermark mounts only a
window of blocks (visible range + overscan + the pinned caret block), backed by
spacer elements that preserve native scroll geometry. Off-window blocks are
absent from the DOM until a scroll or a reveal brings them in. A small document
renders every block with no spacers — windowing stays inactive.

## Happy paths

- Bounded mounted set on a multi-thousand-block doc: the CST has many thousands of top-level blocks, but the live DOM mounts only a small bounded window (≪ the block count), and the load completes (render-wall proof).
- Mounted set is size-independent: loading the same shape at two windowing-active sizes mounts a similarly small window for each; the larger doc has many more CST blocks but not more mounted blocks — the bound is O(viewport), not O(doc).
- Small document stays inactive: a short doc renders every block, with no `.vr-spacer` elements and a DOM top-level count equal to the full block count.

## Edge cases

- Spacers are present only when windowing is active; the small-doc path emits none.

## User interactions

- Ctrl+Shift+End from block 0 selects to the document end, collapsing the caret into the originally off-window last block; typing a marker there lands the marker at the end of the source (exercises the cross-block reveal scroll-and-await branch).
- Scrolling the editor far down unmounts a previously visible top-level block (its `data-block-path` host leaves the DOM).
- After scrolling block 0 off-window, undo of an edit made in block 0 reverts cleanly: the marker is removed from the source, no page error fires, and a subsequent type re-appears in block 0 (the reveal restored focus there). Undo's keydown is block-scoped, so a still-mounted block is focused first to route the key press; undo itself is editor-global and still targets block 0, so the reveal must scroll it back. Known VR limitation: scrolling the caret's block beyond the pin cap drops native focus, so Ctrl+Z is inert until a mounted block holds focus.
- Scrolling to a mid offset and flushing keeps the block at the top of the viewport from vanishing or teleporting. Phase 2 ships estimate-based spacers, so some sub-block drift is expected; precise anchor-correction is a later refinement, so the asserted invariant is non-disappearance, not pixel-perfect stability.

## Scroll-anchor correction (VR-2)

- Deep jump into an unmeasured band holds the viewport: on a doc the estimator badly under-models (tall `<br>`-heavy paragraphs interleaved with short ones), a single deep `scrollTop` jump into a fresh estimate-seeded band lands where the above-viewport blocks measure in far taller than estimate. The editor disables native `overflow-anchor` and corrects manually — it shifts `scrollTop` forward by the model-offset delta as the band measures in (~thousands of px on a 30×-under-modeled fixture) so the content the user was looking at stays in view. The settled `scrollTop` compensation is the discriminator (within-flush block drift reads flat — measure-in and the spacer rewrite land in the same pre-paint pass as the mount); reverting the correction pins `scrollTop` at the exact jump target. The pre-existing "does not teleport / does not vanish" anchor tests stay green at their current tolerances with native anchoring removed — manual correction holds the line they used to rely on the browser for.
- Deep jump into a giant blockquote holds the viewport (NESTED scope): `correctAnchor` is instantiated per scope, and the test above guards only the root instance. On a doc that is ONE blockquote whose `<br>`-heavy quoted children the estimator under-models ~30×, a deep `scrollTop` jump into the nested band is compensated forward by the same multi-thousand-px amount. The compensation is nested-attributable because the single top-level block leaves the root scope's anchor offset structurally 0 (no-op) — only the blockquote's own scope, whose paragraph children enroll in the `correctAnchor`-wrapped batched measure pass, can produce it. Reverting the same `scrollTop += delta` drops the nested compensation to ~0 (same revert as the root test, disjoint responsible scope).

## Resize / width invalidation (VR-1)

- Narrowing the viewport re-measures wrapped heights and holds the anchor: on a windowed doc of long paragraphs that re-wrap with width, scrolling to mount+measure a band at the wide width then narrowing the viewport (a `ResizeObserver` on `.editor` fires on the width delta) clears the oracle's measured cache, rebuilds every scope's model at the new width, and re-measures the mounted blocks. The model-backed `scrollHeight` grows to track the narrower wrap (more lines per paragraph), and the top-of-viewport block does not teleport (the rebuild reseed is anchor-corrected). Reverting the `invalidateWidth` + `widthVersion` wiring leaves the model on stale wide heights: `scrollHeight` does not track and the anchor teleports. Height-only resizes don't bump the version (prose doesn't re-wrap on height). The resize ride composes with VR-2's anchor correction.

## Error cases

- No page errors (e.g. `state_unsafe_mutation`) surface during the off-window reveal, scroll, or undo paths.

## Measure batching (VR-4)

- A fling does not force one reflow per mounted block: flinging ~1 viewport per animation frame through a multi-thousand-block doc mounts hundreds of hosts, but forced synchronous reflows (CDP `LayoutCount`) stay an order of magnitude below the mount count — layouts-per-mount well under 0.3, vs the ~1.0 of the un-batched mount path. Mount measurement rides the scope's read-all-then-write batch; the per-block re-measure effect (BlockHost `measureNow` / TableRowBlock `measureRowNow`) must skip its mount run and fire only on a subsequent edit. Real-browser only — jsdom reports zero layout, so the unit suite can't catch the regression.
- A fling does not force one reflow per mounted table row (table path): rows aren't `BlockHost`s, so the block-path guard (no-table fixture) never exercises TableRowBlock's mount-run skip — reverting only that skip leaves it green. Flinging through a giant windowed table (thousands of rows) mounts hundreds of rows but keeps layouts-per-mount well under 0.3, vs the ~1.0 of the un-skipped path: TableRowBlock's `measureRowNow` edit effect skips its mount run, so the per-row cell read doesn't interleave with the prior row's subtotal write; the table scope's batched read-all-then-write pass owns mount measurement. Counted via `[data-table-row-idx]` mounts and bracketed with CDP `LayoutCount`. Real-browser only.

## Recursive container windowing (Phase 3)

- Giant single blockquote (2MB, one `blockquote` node): mounted set bounded, nested spacers present. [covered]
- Giant single list (2MB, one `list` node): mounted set bounded, spacers inside `.list-block`. [covered]
- Reveal a deep off-window nested target: on a giant list, the deeply nested last leaf is unmounted at load; clicking the first item then Ctrl+Shift+End extends the cross-block selection to that leaf, and typing a marker lands it at the end of the source — `revealByPath` scrolled and mounted the off-window item.
- Collapse-to-start lands the caret in the off-window anchor item: on a giant list, Ctrl+Shift+End scrolls the window to the doc-end focus, so the row-0 anchor item is windowed out by collapse time. ArrowLeft collapses the cross-block selection to the start; the collapse must REVEAL and focus item 0 — a typed marker lands on source line 0 (the anchor item), not the focus item. A pre-fix defect gated the canonical container `revealByPath` on a stale ref slot (an item scrolled off-window leaves a detached ref behind, the conditional-cleanup leftover), so it skipped mounting item 0, descended into the stale ref, and hung the reveal — stranding the caret at the off-window focus item. The CST item count is also unchanged afterward (the body survives the collapse).
- Nested anchor stability: scrolling mid-way into a giant blockquote does not make the top in-view nested block teleport as its heights measure in; the block stays present with only bounded drift.
- List-rebuild height persistence: in a windowed non-uniform list (some items wrap to many lines), scrolling so off-window items measure in and then making a structural edit that changes the item count (Enter at an item end → +1 item) does not collapse the content height or teleport the viewport. List items aren't `BlockHost`s, so their measured box reaches the parent model only via the child-subtotal channel; that channel must persist the box to the oracle by id, or the ListBlock rebuild reseeds every surviving item from estimate and the viewport jumps. Asserted on `.editor` scrollHeight stability and the top in-view nested host's offset.
- Normal-size containers: a small list/blockquote renders with NO spacers (windowing inactive). [covered by the existing small-doc test]

## Table-row windowing (Phase 4)

- Giant single table (2MB, one `table` node): the mounted ROW set is bounded (≪ the row count), with `.vr-spacer`s present inside the `.table-block` grid; no page errors. The grid still lays out — a mounted row's cells form a single horizontal band (one shared top) spanning the table width. Deleting the spacers' `grid-column: 1 / -1` rule shifts the cells by one grid track, splitting each row across two bands, so the shared-top assertion fails.
- Reveal an off-window cell by scroll: on a giant table, far rows are unmounted at load; scrolling near the bottom windows in a far row (idx well past the initial window), and clicking its cell + typing a marker lands the edit in that now-mounted row and reaches the source.
- Reveal an off-window cell by keyboard extend: Ctrl+Shift+End inside a table cell normalizes the focus to a cell-coordinate endpoint at the table block; the extend reconstructs the deep cell path and reveals it, mounting the off-window last row (the active-endpoint pinned-caret invariant). Revealing scrolls the anchor cell off-window, so the dispatch caret is parked at the revealed cell's start to keep the next keystroke routed to a focused block.
- Collapse a keyboard table selection into the revealed cell: after Ctrl+Shift+End, ArrowRight collapses to the end and reconstructs the deep cell path so the caret lands at the end of the off-window cell (via the cell ref, since the cell-coordinate offset is a linear index, not a char offset); typing a marker lands it in that last row and reaches the source.
- Collapse-to-start lands the caret in the off-window anchor cell: after Ctrl+Shift+End, ArrowLeft collapses the cross-block selection to the start (the row-0 anchor cell, scrolled off-window by the extend). The collapse must REVEAL and focus row 0 — the active cell is row 0 and a typed marker lands in row 0's first cell, not the focus cell. A pre-fix defect gated `revealByPath` on a stale ref slot (a row scrolled off-window leaves a detached ref behind), so it skipped mounting row 0 and the caret stranded in the off-window focus cell. The CST row count is also unchanged afterward (the body survives the collapse).
- Table anchor stability: scrolling mid-way into a giant table does not make the row at the top of the viewport teleport as row heights measure in; the row stays present with only bounded drift. Tracked via a **cell's** top, since a `display: contents` row has no box of its own. This is also the correctness check that row heights are measured right — a systematic under-measure blows past the drift bound.
- Table-rebuild height persistence: in a windowed non-uniform table (some rows wrap to many lines), scrolling so off-window rows measure in and then a structural edit that changes the row count (Ctrl+Enter inserts a row) does not collapse the content height or teleport the viewport. Rows aren't `BlockHost`s, so their measured box reaches the model only via the child-subtotal channel; that channel must persist the box to the oracle by id, or the TableBlock rebuild reseeds every surviving row from estimate and the viewport jumps. Asserted on `.editor` scrollHeight stability and the reference row (above the edit) not teleporting.
- Normal-size table: a small table renders with NO spacers (windowing inactive). [covered by the existing small-doc test]
