# Feature: Table block — column affordance menu

A subtle, document-like mouse affordance: column grips sit on the table's top edge,
invisible at rest and revealed on table hover. Clicking a grip opens a contextual
menu anchored at it, listing the column actions plus an L/C/R alignment control.

## Happy paths

- Hovering the table reveals the column grips (one per column at the top); clicking a grip opens a `role="menu"` popover.
- Column grip → "Insert column right" adds an empty column after the grip's column.
- Column grip → "Insert column left" adds an empty column before the grip's column.
- Column grip → "Delete column" removes the grip's column when at least two columns remain.
- The column menu lists the column actions (insert left/right, move left/right, delete) plus an alignment control reflecting the column's current alignment.
- Column grip → alignment control: clicking a segment (L/C/R) sets the targeted (non-first) column's alignment and closes the menu, leaving the other columns plain — Center serializes that column's delimiter to `:---:`, Right to `---:`.
- Alignment via the keyboard-opened cell menu (focus a cell → Shift+F10 → arrow through the menu's roving focus to an L/C/R segment → Enter) closes the menu, restores keyboard focus to a cell in that column instead of dropping it to `<body>`, and announces "Column aligned left/center/right" in the live region (a11y).

## Edge cases

- "Delete column" is disabled (cannot be activated) when only one column remains.
- "Move column left" is disabled on the first column; "Move column right" is disabled on the last column.
- Each menu-driven mutation is a single undo entry — one Ctrl+Z restores the prior state.

## User interactions

- The column grips are pointer-events:none at rest, so a header-cell caret click is never intercepted while the table is not hovered.
- While the table is hovered (grips lifted to pointer-events:auto), a header-cell caret click still lands in the cell — the grip's top-of-column geometry leaves the cell body clickable.
- Clicking outside the open menu closes it without committing anything.
- Pressing Escape closes the open menu without committing anything.
- Opening a grip menu then choosing an action commits exactly once and closes the menu.

## Notes

- Menu keyboard navigation is owned by `a11y/table-menu.md` (Shift+F10 open, roving arrows, wrap, disabled-skip, Tab trapping, Escape); this file covers mouse open/close, column action dispatch, and the alignment control.
