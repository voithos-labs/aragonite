# Feature: single-block paste crosses the live join seam

A paste over a selection inside ONE block is a delete-then-insert, and its delete
half is a join like every merge, range delete, cut and type-over: the two sides
the cut leaves meet at a seam. In live mode the delimiter runs a cut strands are
bytes the reader never saw, so a literal splice pastes them into view — an
unmatched `**` is not a construct, so it renders as plain visible text. Every
other join already crossed `cleanJoinedRaw`; the paste surfaces spliced their own
bytes, which is what this pins closed. Driven on `/test/editor`; the oracle is
what the block SHOWS (its text minus the spans a marker-hiding mode drops), not
just the source, because the source is legitimately allowed to differ per mode.

## Happy paths

- live: pasting over a range that starts inside `**bold**` and ends past its
  closer leaves no `*` in the block's visible text, and the stranded opener is
  gone from the source rather than pasted into view
- source: the same paste is byte-literal — every marker is painted there, so the
  cut is the user's own bytes and nothing may be dropped

## Edge cases

- the payload is copied from a real block and pasted with a real `Mod+V`, so the
  dispatch takes the same route a user's paste does (a programmatic write would
  skip the surface that owns the splice)
- the selection is built with `Shift+ArrowRight` from a real caret: in live one
  press crosses the whole hidden run, which is what puts the range's end past the
  closer

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
