# Feature: Table block — row affordance menu

Row grips sit in the left gutter, invisible at rest and revealed on table hover.
Clicking a grip opens a contextual menu anchored at it, listing the row actions only —
alignment is column-scoped and never appears here.

## Happy paths

- Hovering the table reveals one row grip per row (header + body rows; the delimiter line is not a row); clicking a grip opens the menu for that row.
- Row grip → "Delete row" removes that body row.
- Row grip → "Insert row below"/"Insert row above" adds a body row after/before the grip's row.
- The row menu lists the row actions only (no alignment control — alignment is column-scoped).

## Edge cases

- "Delete row" is disabled when only one body row remains.
- The header row is positionally fixed: its grip menu offers insert/delete but "Move row up"/"Move row down" are disabled.
- "Move row up" is disabled on the first body row; "Move row down" is disabled on the last body row.

## User interactions

- The row grips are pointer-events:none at rest, so a first-cell caret click is never intercepted while the table is not hovered.
- While the table is hovered, a first-cell caret click still lands in the cell — the row grip's left-gutter geometry leaves the cell body clickable.

## Notes

- Row grips live in a zero-width leading gutter track; the grid stays unshifted so caret geometry is untouched (the grip's dots overflow into the first cell's left padding).
- Menu keyboard navigation is owned by `a11y/table-menu.md`; menu open/close and Escape are pinned once in `affordance-menu-column.md`, which drives the same popover.
