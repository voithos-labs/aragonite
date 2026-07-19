# Feature: Folded render-primary leaf paints its cross-block selection endpoint box

A render-primary leaf (block math, TOC) shows a rendered island while folded, with
no source text node to measure. When such a leaf is the range-START endpoint of a
cross-block sweep, its `measurePartialRects` covers the rendered block box (the
same opaque-single-unit fallback the childless-container shim carries), so the
endpoint paints its full box — previously nothing painted. Direct sibling of the
mermaid childless-container case (`plugins/mermaid-selection-overlay.md`, test 2),
but for a folded LEAF rather than a container.

## Happy paths

- Block math (`$$…$$`) between two paragraphs, folded (rendered). An upward
  keyboard sweep from the paragraph below that ends ON the math block paints the
  math block's own selection-endpoint box (non-zero width and height), not a
  middle overlay.
