# Feature: Highlights repaint over off-window table rows

A very tall table keeps only a window of rows mounted. Search auto-reveals
only the active match, so matches in deep unmounted rows have no highlight
yet — when the user scrolls those rows into view, the highlight must appear
on that first scroll, not after an extra nudge. Cross-block selections over
the same deep rows owe the same repaint.

## Happy paths

- With matches spread through a ~200-row table, searching reveals the first
  match at the top; a single scroll to the bottom mounts the deep matching
  rows and the match highlight paints over the newly visible cell — with no
  page errors.
- A cross-block selection from a paragraph above the table to the end of the
  document: after a single scroll to the bottom, the selection highlight
  paints over the newly mounted deep rows — with no page errors.
