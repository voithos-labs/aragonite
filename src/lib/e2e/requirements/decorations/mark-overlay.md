# Feature: Decoration mark overlay

A `mark` decoration paints a positioned overlay div over its inline range, carrying the
class the source supplies (and optional attributes) so a consumer can style it. The overlay
reads the decoration state once per block host, the same path search's own highlights take:
leaves measure their own range, grid cells paint whole-cell rects, and nothing paints when
no source is registered.
Sources register through the public registry, here through the e2e bridge rather than a plugin.

## Happy paths

- A mark over `[0]` 0..5 paints exactly one `.decoration-overlay` carrying the source's class,
  whose left and right edges sit on the painted word `hello`, measured off its text node
- A mark spanning a soft-wrapped range paints one rect per visual line (2+ rects), each with
  positive width: the per-line measurement the leaf's `measurePartialRects` returns
- A mark on a table cell (`[0,row,col]`) paints one whole-cell overlay over that cell

## User interactions

- An `interactive` mark receives a real mouse click: clicking the overlay runs the source's
  `onClick`; a non-interactive mark ignores pointer events (base `pointer-events: none`)

## Edge cases

- A source whose output tracks the document repaints after an edit: typing a new occurrence of
  the marked term adds a matching overlay (the commit → notifyEdit → re-provide path)
- A marked block whose kind changes (`# ` typed at its start turns a paragraph into a heading)
  keeps its overlay, re-measured at the new geometry
- A mark still paints after switching to reading mode: decorations are view-only, so an inert
  read-only block with no caret does not suppress the overlay
- Disposing the source unpaints every overlay it produced
