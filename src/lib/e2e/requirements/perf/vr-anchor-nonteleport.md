# Feature: Virtual rendering, non-disappearance after a mid-document scroll

Windowing ships estimate-based spacers, so the box at the top of the viewport must neither
vanish nor teleport as off-window heights measure in. Some sub-block drift is expected under
estimate-based spacers; what is asserted is that the box stays on screen and drifts within a
bound, not that it is pixel-perfect. One scenario per windowed block list.

## Happy paths

- Flat document, the root list: scrolling to a mid offset and flushing keeps the top visible block present, with bounded drift.
- A nested list: scrolling mid-way into a giant blockquote does not make the top in-view nested block teleport as its heights measure in.
- Table rows: scrolling mid-way into a giant table does not make the row at the top of the viewport teleport. Tracked via a **cell's** top, since a `display: contents` row has no box of its own. It is also the check that row heights are measured right, since a systematic under-measure blows past the drift bound.

## Error cases

- No page errors surface on any of the three scroll paths.
