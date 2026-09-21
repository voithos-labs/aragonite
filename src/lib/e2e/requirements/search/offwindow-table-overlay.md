# Feature: Highlights repaint over off-window table rows

A very tall table keeps only a window of rows mounted. Search scrolls only the
active match into view, so matches in deep unmounted rows have no highlight
yet. When the user scrolls those rows into view, the highlight must appear
on that first scroll, not after an extra nudge. Cross-block selections over
the same deep rows must repaint the same way.

## Happy paths

- With matches spread through a ~200-row table, the last row among them so
  the bottom viewport holds one whatever the row height, searching reveals the
  first match at the top; a single scroll to the bottom mounts the deep
  matching rows and the match highlight paints over the newly visible cell,
  with no page errors.
- A cross-block selection from a paragraph above the table to the end of the
  document: after a single scroll to the bottom, the selection highlight
  paints over the newly mounted deep rows, with no page errors.
