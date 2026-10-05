# Feature: A collapsed render-primary leaf paints its cross-block selection endpoint box

A render-primary leaf (block math, TOC) shows a rendered widget while collapsed, with
no source text node to measure. When a cross-block sweep starts on such a leaf and
covers all of it, the leaf paints one full box, the same box the blocks between the
ends get, so it's never left painting nothing. It's the direct sibling of the mermaid
childless-container case (`plugins/mermaid-selection-overlay.md`, test 2), but for a
collapsed leaf rather than a container.

## Happy paths

- Block math (`$$…$$`) between two paragraphs, collapsed to its render. An upward
  keyboard sweep from the paragraph below ends at the math block's start, so it
  covers the whole block, and the block paints one box of its own (non-zero width
  and height) and no other selection rect.
