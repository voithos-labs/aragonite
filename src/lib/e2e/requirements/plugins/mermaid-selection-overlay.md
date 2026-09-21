# Feature: Cross-block selection overlay over childless opaque containers

A container block with no child block hosts, such as a render-primary plugin block like mermaid,
has no children to paint cross-block selection highlights, so the block itself has to take the
full-block overlay when it sits strictly inside a cross-block range. It is the same whole-block
highlight a non-text leaf such as a thematic break gets, and the same box a container with
children takes when the range holds it whole.

## Happy paths

- A Shift+ArrowDown sweep from the paragraph above a rendered diagram to the paragraph below
  paints the full-block `.selection-overlay-middle` on the mermaid block
- A sweep upward from the paragraph below that ends on the diagram paints the mermaid's own box
  as an endpoint rect: the container provides `measurePartialRects`, so as the block the range
  starts in it measures itself instead of painting nothing
- The same sweep across a broken diagram, an error card with no rendered view, paints the same
  full-block overlay, because what the selection looks like does not depend on the state

## Edge cases

- An opaque container with children, a callout, that the range holds whole paints one
  container-level box, its title row included, and its child block hosts paint none, so nothing
  is painted twice

## Miss-analysis

- 2026-07 (defect: mermaid invisible in a cross-block sweep): the overlay specs only drove
  containers with children, such as blockquotes, so the classification's assumption that the
  children will paint it was never exercised against a container with none. A sweep scenario
  over a plugin kind would have caught it at the first whole-block kind.
