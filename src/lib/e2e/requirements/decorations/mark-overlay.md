# Feature: Decoration mark overlay

A `mark` decoration paints a positioned overlay div over its inline range, carrying the
source-supplied class (and optional attributes) so a consumer styles it. The overlay reads
the decoration engine per block host — the same surface search's own highlights ride: leaves
measure their own range, grid cells paint whole-cell rects, and nothing paints when no source
is registered.
Sources register through the public registry — here via the e2e bridge, no plugin needed.

## Happy paths

- A mark over `[0]` 0..5 paints exactly one `.decoration-overlay` carrying the source's class,
  positioned inside block 0 with a positive width
- A mark spanning a soft-wrapped range paints one rect per visual line (2+ rects), each with
  positive width — the per-line measure the leaf's `measurePartialRects` returns
- A mark on a table cell (`[0,row,col]`) paints one whole-cell overlay over that cell

## User interactions

- An `interactive` mark receives a real mouse click: clicking the overlay runs the source's
  `onClick`; a non-interactive mark ignores pointer events (base `pointer-events: none`)

## Edge cases

- A source whose output tracks the document repaints after an edit: typing a new occurrence of
  the marked term adds a matching overlay (the commit → notifyEdit → re-provide path)
- A marked block whose kind changes (`# ` typed at its start turns a paragraph into a heading)
  keeps its overlay, re-measured at the new geometry
- A mark still paints after flipping to reading mode: decorations are view-only, so an inert
  read-only surface (no caret) does not suppress the overlay
- Disposing the source unpaints every overlay it produced
