# Feature: Table block — on-hover affordance menu (row + column)

A subtle, document-like mouse affordance: row grips (left gutter) and column grips
(top edge) are invisible at rest and reveal on table hover. Clicking a grip opens a
contextual action menu anchored at the grip — the column menu lists column actions
plus an inert L/C/R alignment control; the row menu lists row actions only. The
menu's action items dispatch the committed table mutations.

## Happy paths

- Hovering the table reveals the column grips (one per column at the top); clicking a grip opens a `role="menu"` popover.
- Column grip → "Insert column right" adds an empty column after the grip's column.
- Column grip → "Insert column left" adds an empty column before the grip's column.
- Column grip → "Delete column" removes the grip's column when at least two columns remain.
- The column menu lists the column actions (insert left/right, move left/right, delete) plus an alignment control reflecting the column's current alignment.
- Hovering the table reveals one row grip per row (header + body rows; the delimiter line is not a row); clicking a grip opens the menu for that row.
- Row grip → "Delete row" removes that body row.
- Row grip → "Insert row below"/"Insert row above" adds a body row after/before the grip's row.
- The row menu lists the row actions only (no alignment control — alignment is column-scoped).

## Edge cases

- "Delete column" is disabled (cannot be activated) when only one column remains.
- "Move column left" is disabled on the first column; "Move column right" is disabled on the last column.
- "Delete row" is disabled when only one body row remains.
- The header row is positionally fixed: its grip menu offers insert/delete but "Move row up"/"Move row down" are disabled.
- "Move row up" is disabled on the first body row; "Move row down" is disabled on the last body row.
- Each menu-driven mutation is a single undo entry — one Ctrl+Z restores the prior state.

## User interactions

- The column grips are pointer-events:none at rest, so a header-cell caret click is never intercepted while the table is not hovered.
- While the table is hovered (grips lifted to pointer-events:auto), a header-cell caret click still lands in the cell — the grip's top-of-column geometry leaves the cell body clickable.
- The row grips are pointer-events:none at rest, so a first-cell caret click is never intercepted while the table is not hovered.
- While the table is hovered, a first-cell caret click still lands in the cell — the row grip's left-gutter geometry leaves the cell body clickable.
- Clicking outside the open menu closes it without committing anything.
- Pressing Escape closes the open menu without committing anything.
- Opening a grip menu then choosing an action commits exactly once and closes the menu.

## Structural invariants

- The table grid containers (`.table-block`, `.table-row`) have no whitespace-only direct child text nodes. Such a node joins the raw-offset walk (cursor/widget-offset.ts counts every text node, including aria-hidden grip markup) and shifts a parked cross-block caret, so the grip markup's block boundaries must stay adjacent.

## Notes

- Row grips live in a zero-width leading gutter track; the grid stays unshifted so caret geometry is untouched (the grip's dots overflow into the first cell's left padding).
- Full menu keyboard navigation and the alignment control's wiring are later tasks; this slice covers mouse open/close + row/column action dispatch.
