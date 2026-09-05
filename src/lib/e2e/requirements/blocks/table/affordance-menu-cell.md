# Feature: Table block — cell right-click menu

Right-clicking a cell opens the same affordance popover the grips do, but a cell knows
both axes, so the menu carries the row group and the column group together. The
clipboard items that also live in this menu are covered by `right-click-clipboard.md`.

## Happy paths

- Right-clicking anywhere in a cell opens the menu showing both the row group and the column group (a cell knows both axes).
- Right-click → "Delete column" removes the clicked cell's column (routed by the clicked colIdx, independent of any row action).
- Right-click → "Delete row" removes the clicked cell's row (routed by the clicked rowIdx, independent of any column action).

## Edge cases

- Right-clicking outside the table (e.g. a paragraph) does not open the affordance menu — the contextmenu handler is scoped to the table grid, and only suppresses the native menu when the pointer is over a cell.
- Right-clicking a cell inside an active intra-table rectangle selection opens the menu WITHOUT collapsing the rectangle — the pointerdown clear + drag-install are skipped for the secondary button, so the menu's Cut/Copy still see the rectangle.
