# Feature: Folded render-primary leaf paints its cross-block selection endpoint box

A render-primary leaf (block math, TOC) shows a rendered widget while collapsed, with
no source text node to measure. When such a leaf is the start endpoint of a
cross-block sweep, its `measurePartialRects` covers the rendered block box (the
same whole-block fallback the childless-container code uses), so the endpoint paints
its full box rather than nothing. It is the direct sibling of the mermaid
childless-container case (`plugins/mermaid-selection-overlay.md`, test 2), but for a
collapsed leaf rather than a container.

## Happy paths

- Block math (`$$…$$`) between two paragraphs, collapsed to its render. An upward
  keyboard sweep from the paragraph below that ends on the math block paints the
  math block's own selection-endpoint box (non-zero width and height), not a
  middle overlay.
