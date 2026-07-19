# Feature: Cross-block selection overlay over childless opaque containers

A container block with NO child block-hosts (a render-primary plugin block like mermaid)
has no children to paint cross-block selection highlights, so the block itself must take
the full-block overlay when it sits strictly inside a cross-block range — the same
whole-block highlight a non-text leaf (thematic break) gets. Child-bearing containers keep
delegating: their children paint, the container never double-paints.

## Happy paths

- A Shift+ArrowDown sweep from the paragraph above a rendered diagram to the paragraph
  below paints the full-block `.selection-overlay-middle` on the mermaid block
- An upward sweep from the paragraph below that ENDS on the diagram paints the mermaid's
  own box as an endpoint rect — the container surfaces `measurePartialRects`, so as the
  range-start block it measures itself instead of painting nothing
- The same sweep across a BROKEN diagram (error card, no viewport) paints the same
  full-block overlay — the selection visual is state-independent

## Edge cases

- A child-bearing opaque container (callout) strictly inside a range paints NO
  container-level overlay; its child block-hosts paint their own (no double paint)

## Miss-analysis

- 2026-07 (defect: mermaid invisible in a cross-block sweep): the overlay spec suite only
  drove containers WITH children (blockquote), so the container-classification gate's
  children-will-paint assumption was never exercised against a childless container. A
  plugin-surface sweep scenario would have caught it at the first whole-block kind.
