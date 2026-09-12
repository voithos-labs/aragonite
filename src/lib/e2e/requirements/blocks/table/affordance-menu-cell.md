# Feature: Table block — cell right-click menu

Right-clicking a cell is the only pointer road into the table's affordance popover, and a
cell knows both axes, so the menu carries the row group and the column group together. The
insert and move actions of each axis fold behind a "Row" / "Column" flyout; the two deletes
and the column alignment stay top-level. The clipboard items that also live in this menu are
covered by `right-click-clipboard.md`.

## Happy paths

- Right-clicking anywhere in a cell opens the menu showing both the row group and the column group (a cell knows both axes).
- Right-click → "Delete column" removes the clicked cell's column (routed by the clicked colIdx, independent of any row action).
- Right-click → "Delete row" removes the clicked cell's row (routed by the clicked rowIdx, independent of any column action).
- Row flyout → "Insert row below" adds an empty body row directly below the clicked cell's row.
- Column flyout → "Insert column right" adds an empty column directly right of the clicked cell's column.
- Row flyout → "Move row down" swaps the clicked row past the next one.
- Column flyout → "Move column right" swaps the clicked column past the next one (header and body together).
- The alignment trio rewrites the delimiter row for the clicked cell's column only — the sibling columns keep their own alignment.

## Edge cases

- Right-clicking outside the table (e.g. a paragraph) does not open the affordance menu — the contextmenu handler is scoped to the table grid, and only suppresses the native menu when the pointer is over a cell.
- Right-clicking a cell inside an active intra-table rectangle selection opens the menu WITHOUT collapsing the rectangle — the pointerdown clear + drag-install are skipped for the secondary button, so the menu's Cut/Copy still see the rectangle.
- The moves are disabled at the near end of each axis: "Move row up" on the first body row, "Move column left" on the first column — and both stay enabled in the other direction.
- Both deletes are disabled when the table is down to one body row and one column, and a forced click on a disabled row commits nothing.
- Hovering the sibling group row swaps which flyout is showing — only one is open at a time.
- Keyboard-driven alignment (roving focus into the trio, Enter) returns focus to a cell and announces the new alignment in the live region.
