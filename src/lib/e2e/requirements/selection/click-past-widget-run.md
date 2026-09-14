# Feature: clicking beside a run of adjacent atomic islands

An atomic inline island (an emoji glyph, a decoded entity, an image) holds no caret position of
its own, so a click beside one snaps the caret to the island's raw edge. When several islands sit
flush against each other, the point is beside exactly one of them, and the snap must read the edge
nearest the point rather than the first island the point happens to be past.

Miss-analysis: every click-snap test ran against a block holding ONE island, where "the first
island the point is past" and "the island nearest the point" are the same answer, so no test could
tell the two rules apart.

## Happy paths

- Click past the last of four flush glyph islands: the caret seats after the last island's bytes,
  so a typed character lands at the end of the line.
- Click past a lone island on the line: the caret seats after that island's bytes (unchanged by
  the nearest-edge rule).

## User interactions

- The same click in live mode, where the markers are hidden: same landing, since hiding changes no
  walk offset.
