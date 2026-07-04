# Feature: Virtual rendering — windowing bounds (top-level + containers)

A document whose estimated height clears the activation watermark mounts only a
window of blocks (visible range + overscan + the pinned caret block), backed by
spacer elements that preserve native scroll geometry. A small document renders
every block with no spacers — windowing stays inactive. The bound holds for flat
docs and for a single giant blockquote / list / table container.

## Happy paths

- Bounded mounted set on a multi-thousand-block doc: the CST has many thousands of top-level blocks, but the live DOM mounts only a small bounded window (≪ the block count), and the load completes (render-wall proof).
- Mounted set is size-independent: loading the same shape at two windowing-active sizes mounts a similarly small window for each; the larger doc has many more CST blocks but not more mounted blocks — the bound is O(viewport), not O(doc).
- Small document stays inactive: a short doc renders every block, with no `.vr-spacer` elements and a DOM top-level count equal to the full block count.

## Edge cases

- Spacers are present only when windowing is active; the small-doc path emits none.
- Windowed spacers carry a placeholder background (VR-8 skeleton): a spacer's computed background is a non-transparent placeholder tint (the editor.css `--vr-spacer-bg` token), not the unreachable gap — removing the rule or the token drops the alpha to 0 and fails the check.

## Recursive container windowing (Phase 3 / Phase 4)

- Giant single blockquote (2MB, one `blockquote` node): mounted set bounded, nested spacers present.
- Giant single list (2MB, one `list` node): mounted set bounded, spacers inside `.list-block`.
- Giant single table (2MB, one `table` node): the mounted ROW set is bounded (≪ the row count), with `.vr-spacer`s present inside the `.table-block` grid; no page errors. The grid still lays out — a mounted row's cells form a single horizontal band (one shared top) spanning the table width. Deleting the spacers' `grid-column: 1 / -1` rule shifts the cells by one grid track, splitting each row across two bands, so the shared-top assertion fails.
- Normal-size containers: a small list/blockquote/table renders with NO spacers (windowing inactive) — covered by the small-doc path.

## Error cases

- No page errors surface during load or scroll.
