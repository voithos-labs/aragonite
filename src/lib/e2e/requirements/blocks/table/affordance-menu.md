# Feature: Table block — on-hover column affordance menu

A subtle, document-like mouse affordance: column grips are invisible at rest and
reveal on table hover. Clicking a grip opens a contextual action menu anchored at
the grip. The menu's action items dispatch the committed table mutations; an inert
L/C/R alignment control previews the column's alignment (wiring is a later task).

## Happy paths

- Hovering the table reveals the column grips (one per column at the top); clicking a grip opens a `role="menu"` popover.
- Column grip → "Insert column right" adds an empty column after the grip's column.
- Column grip → "Insert column left" adds an empty column before the grip's column.
- Column grip → "Delete column" removes the grip's column when at least two columns remain.
- The menu lists the column actions (insert left/right, move left/right, delete) plus an alignment control reflecting the column's current alignment.

## Edge cases

- "Delete column" is disabled (cannot be activated) when only one column remains.
- "Move column left" is disabled on the first column; "Move column right" is disabled on the last column.
- Each menu-driven mutation is a single undo entry — one Ctrl+Z restores the prior state.

## User interactions

- The grips are pointer-events:none at rest, so a header-cell caret click is never intercepted while the table is not hovered.
- While the table is hovered (grips lifted to pointer-events:auto), a header-cell caret click still lands in the cell — the grip's top-of-column geometry leaves the cell body clickable.
- Clicking outside the open menu closes it without committing anything.
- Pressing Escape closes the open menu without committing anything.
- Opening a grip menu then choosing an action commits exactly once and closes the menu.

## Notes

- Row grips and the row menu are a separate task (7b); they reuse the same grip + menu components and reveal CSS.
- Full menu keyboard navigation and the alignment control's wiring are later tasks; this slice covers mouse open/close + column action dispatch.
