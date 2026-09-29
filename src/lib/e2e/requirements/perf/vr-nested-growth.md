# Feature: Virtual rendering, growth inside a container is corrected once

When something above the viewport grows, the editor scrolls by the growth so
what you're looking at stays put. Inside a container, one growth shows up in
two tables: the container's own list (a block in it got taller) and the list
above it (the container got taller). The editor picks the one block to keep
still before the round of measurements and scrolls by how far that block
moved, so the growth counts once either way.

Driven on `/test/editor` over a windowed document with a container at root
index 30. An image inside it is held back until the page settles, and its
decode adds about 900px. The release waits for the image to decode or for its
block to unmount, so an over-correction fails an assertion instead of timing
out.

Miss-analysis: every anchor spec grew a block at the top level or inside the
target's own container, and none grew one inside a container above the
viewport, the case the design doc listed as a known limitation. Then, once no
list reported its height upward, the one unit row that held a nested growth
to a single correction ("no cascade up the chain") was rewritten to assert the
list corrects, and nothing ran a container holding the viewport's top.

## Happy paths

- a five-item list wholly above the viewport, the image in the last item's
  last block: the block at the viewport's top moves by at most 1px (red before
  the fix: it moved 900px, no correction at all)
- the same list, the image in a middle item with a block after it: the block
  at the viewport's top moves by at most 1px (green before the fix too; kept
  as a pin)

## Edge cases

The container holds the viewport's top here: the image is child 1 and the
top sits inside child 6. The reference is root block 32, below the container,
wherever it's on screen, else child 6's first block.

- a 10-item list, the caret clicked into root block 32: root block 32 moves by
  at most 1px (red before the fix: +900, none; red on the first cut of this
  slice: -869, twice)
- a 10-item list, no caret: the same (red before the fix: +900; on the first
  cut the page scrolled root block 32 out, twice)
- a 40-item list, no caret: child 6 moves by at most 1px (red before the fix:
  +900)
- a 10-paragraph blockquote, the caret in root block 32: root block 32 moves by
  at most 1px (green before the fix; red on the first cut of this slice: -869)
- a 10-paragraph blockquote, no caret: the same (green before the fix; the
  first cut scrolled root block 32 out)
- a 40-paragraph blockquote, no caret: child 6 moves by at most 1px (green
  throughout, kept as the case where the container outlasts the growth)

## Error cases

- no page errors surface during the load, the scroll or the decode
