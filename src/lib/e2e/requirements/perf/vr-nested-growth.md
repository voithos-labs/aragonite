# Feature: Virtual rendering, growth inside a list above the viewport is corrected once

When something above the viewport grows, the editor scrolls by the growth so
what you're looking at stays put. Inside a list, three block lists are in
play: the item's own blocks, the list's items, and the document's top level.
The growth gets corrected exactly once, by the list whose range holds the
viewport's top, and never by a list that sits wholly above it.

Driven on `/test/editor` over a windowed document with a five-item list thirty
paragraphs down. The page is scrolled until the list mounts, then just past it,
so the list is above the viewport's top and still mounted. An image inside the
list is held back until then, and its decode adds about 900px.

Miss-analysis: every anchor spec grew a block at the top level or inside the
target's own container, and none grew one inside a container above the
viewport, the case the design doc listed as a known limitation.

## Happy paths

- the image sits in the last item's last block: once it decodes, the block at
  the viewport's top moves by at most 1px (red before the fix: it moved 900px,
  since the list's own upward report reached the table first and the resize
  that would have corrected found nothing left to correct)
- the image sits in a middle item, with a block after it in that item: the
  block at the viewport's top moves by at most 1px (green before the fix too;
  kept, since the item's inner list holding its last block would have
  corrected the growth a second time once the upward report went)

## Error cases

- no page errors surface during the load, the scroll or the decode
