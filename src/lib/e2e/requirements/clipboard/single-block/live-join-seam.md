# Feature: single-block paste crosses the live join

A paste over a selection inside one block replaces that selection with the pasted
text, same as typing over it. In live mode the range can end halfway through a
construct, and the delimiter runs the cut strands are bytes you never saw. Pasted
literally, an unmatched `**` isn't a construct anymore, so it shows up as plain text.
So the paste goes through the same replace typing uses (`replaceRangeInLeaf`), with
the pasted text already in the join: it keeps a run the text fills back in, and drops
one it doesn't. Driven on `/test/editor`; what's checked is what the block shows (its
text minus the spans a marker-hiding mode drops), not only the source, since the
source is allowed to differ per mode.

## Happy paths

- live: pasting over a range that starts inside `**bold**` and ends past its
  closer leaves no `*` in the block's visible text, and the stranded opener is
  gone from the source rather than pasted into view
- source: the same paste is byte-literal, since every marker is painted there, so
  the cut is the user's own bytes and nothing may be dropped
- a table cell pastes the same way: the cell splices its own bytes and escapes
  them where they are written, and the join runs before that step, so the run its
  cut strands goes with the cut instead of onto the screen and the cell's own
  `\|` still comes back escaped (the escaping runs after the join, over whatever
  bytes it wrote)
- source: the same cell paste is byte-literal too, since the walk crosses the
  painted delimiters one character at a time and the halves it leaves stand as cut
- live, at the top level and in a list item: pasting `X` over the whole word in
  `**bold** text` gives `**X** text`, same bytes as typing `X` over that selection.
  The pasted text fills the bold back in, so there's nothing stranded to clean up

## Edge cases

- the payload is copied from a real block and pasted with a real `Mod+V`, so the
  dispatch takes the same route a user's paste does (a programmatic write would
  skip the block that owns the splice)
- the selection is built with `Shift+ArrowRight` from a real caret: in live one
  press crosses the whole hidden run, which is what puts the range's end past the
  closer

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)

## Miss-analysis

The paste rows only ever cut a range that left a run unpaired, never one the pasted
text fills back in, so nobody noticed the cut got cleaned up before the text arrived
(and dropped the bold that typing keeps).
