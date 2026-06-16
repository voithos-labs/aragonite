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

## Error cases

- No page errors (e.g. `state_unsafe_mutation`) surface during the off-window reveal, scroll, or undo paths.
