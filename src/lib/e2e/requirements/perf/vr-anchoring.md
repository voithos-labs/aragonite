# Feature: Virtual rendering — scroll-anchor stability

Windowing ships estimate-based spacers, so as off-window blocks measure in the
editor must hold the viewport rather than let content vanish, teleport, or drift.
The editor disables native `overflow-anchor` and owns scroll-anchor correction
per scope. This covers deep jumps into unmeasured bands, viewport resize, above-fold
inserts, column pinning, and below-fold reorders.

## Non-disappearance / non-teleport

- Scrolling to a mid offset and flushing keeps the block at the top of the viewport from vanishing or teleporting. Some sub-block drift is expected under estimate-based spacers; the asserted invariant is non-disappearance / bounded drift, not pixel-perfect stability.
- Nested anchor stability: scrolling mid-way into a giant blockquote does not make the top in-view nested block teleport as its heights measure in; the block stays present with only bounded drift.
- Table anchor stability: scrolling mid-way into a giant table does not make the row at the top of the viewport teleport as row heights measure in; the row stays present with only bounded drift. Tracked via a **cell's** top, since a `display: contents` row has no box of its own — also the correctness check that row heights are measured right (a systematic under-measure blows past the drift bound).

## Scroll-anchor correction (VR-2)

- Deep jump into an unmeasured band holds the viewport: on a doc the estimator badly under-models (tall `<br>`-heavy paragraphs interleaved with short ones), a single deep `scrollTop` jump into a fresh estimate-seeded band lands where the above-viewport blocks measure in far taller than estimate. The editor shifts `scrollTop` forward by the model-offset delta as the band measures in (~thousands of px on a 30×-under-modeled fixture) so the content the user was looking at stays in view. The settled `scrollTop` compensation is the discriminator (within-flush block drift reads flat); reverting the correction pins `scrollTop` at the exact jump target.
- Deep jump into a giant blockquote holds the viewport (NESTED scope): `correctAnchor` is instantiated per scope, and the root test guards only the root instance. On a doc that is ONE blockquote whose `<br>`-heavy quoted children the estimator under-models ~30×, a deep `scrollTop` jump into the nested band is compensated forward by the same multi-thousand-px amount. The compensation is nested-attributable because the single top-level block leaves the root scope's anchor offset structurally 0 (no-op) — only the blockquote's own scope, whose paragraph children enroll in the `correctAnchor`-wrapped batched measure pass, can produce it. Reverting the same `scrollTop += delta` drops the nested compensation to ~0.

## Resize / width invalidation (VR-1)

- Narrowing the viewport re-measures wrapped heights and holds the anchor: on a windowed doc of long paragraphs that re-wrap with width, scrolling to mount+measure a band at the wide width then narrowing the viewport clears the oracle's measured cache, rebuilds every scope's model at the new width, and re-measures the mounted blocks. The model-backed `scrollHeight` grows to track the narrower wrap, and the top-of-viewport block does not teleport (the rebuild reseed is anchor-corrected). Reverting the `invalidateWidth` + `widthVersion` wiring leaves the model on stale wide heights: `scrollHeight` does not track and the anchor teleports. Height-only resizes don't bump the version.

## Structural-edit height persistence

- List-rebuild height persistence: in a windowed non-uniform list (some items wrap to many lines), scrolling so off-window items measure in and then making a structural edit that changes the item count (Enter at an item end → +1 item) does not collapse the content height or teleport the viewport. List items aren't `BlockHost`s, so their measured box reaches the parent model only via the child-subtotal channel; that channel must persist the box to the oracle by id, or the ListBlock rebuild reseeds every surviving item from estimate and the viewport jumps. Asserted on `.editor` scrollHeight stability and the top in-view nested host's offset.
- Table-rebuild height persistence: in a windowed non-uniform table (some rows wrap to many lines), scrolling so off-window rows measure in and then a structural edit that changes the row count (Ctrl+Enter inserts a row) does not collapse the content height or teleport the viewport. Rows aren't `BlockHost`s, so their measured box reaches the model only via the child-subtotal channel; that channel must persist the box to the oracle by id, or the TableBlock rebuild reseeds every surviving row from estimate and the viewport jumps. Asserted on `.editor` scrollHeight stability and the reference row (above the edit) not teleporting.

## Above-fold and below-fold edits

- Inserting a block above the fold holds the viewport (F4): inserting a block above the current window remaps the anchor by stable id so the visible content holds its Y position; reverting the id-remap fails the held-Y bound.
- A column does not shrink when its widest cell scrolls out of the window (F6): the column-width pin holds a table column at its measured max even after its widest cell unmounts; reverting the pin lets the column collapse to the narrow rows' width after the scroll, failing the width bound.
- Reordering a list item below the fold does not drift scrollTop (F7): when the list scope has no content scrolled above the viewport top (localScrollTop === 0), one Alt+Up + Alt+Down no-op reorder cycle must return scrollTop to baseline. The structural anchor correction would otherwise follow the relocated anchor block and shift the shared scrollTop (asymmetric per-press drift pre-fix).

## Error cases

- No page errors surface during the jump, resize, insert, or reorder paths.
