# Feature: Mouse drag-reorder of table rows (row grip)

Dragging a body row's grip moves that row among the body rows, mirroring the
top-level block-drag handle. A single insertion line marks the drop gap during
the drag; one row move commits on release (one undo step). The header row is
positionally fixed — its grip never starts a drag, and a body row can never drop
above it. A grip press under the move threshold is a CLICK, not a drag: it still
opens the affordance menu.

Scope: tables whose rows are all on-screen. Autoscroll and windowed-table drag
are a separate layer.

## Happy paths

- Dragging the first body-row grip down past the next body row reorders with
  insert semantics: the dragged row lands where the line showed.
- After a drag the caret is usable in the moved row (typing lands a marker).

## Edge cases

- Dragging the header-row grip is a no-op — no source mutation, no insertion
  line (the header is fixed, mirroring the keyboard no-op).
- A drag is a single undo entry; undo restores the pre-drag source exactly,
  including a non-canonical (tight-padding) table's original bytes.
- A drag leaves no container-parity mismatch and logs no page error (node
  identity and per-row state survive the move).

## User interactions

- Real pointer gesture: hover the table to reveal grips, press the body-row
  grip, move past the threshold, release over the destination row.
- A plain grip click (press/release without crossing the threshold) opens the
  affordance menu instead of reordering.

## Accessibility

- Mouse-only affordance; the keyboard reorder chord (Alt+Arrow) remains the
  operable, screen-reader path and is covered by reorder-row.spec.ts.
