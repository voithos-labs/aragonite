# Feature: Row moves on a row-windowed table

Extends `reorder-row.md` and `menu-row-flyout.md` to tall tables whose body rows are
virtualized. Once the editor is scrolled to the bottom, row 0 is unmounted and a mounted
row's local position no longer equals its CST index, so both routes (the Alt+Arrow chord and
the Row flyout) must move the row by its absolute index, and the announcement must name that.

## Happy paths

- Alt+ArrowDown in a deep row of a windowed table (row 0 off-window) moves exactly that row past the next one, and the live region announces its absolute 1-based body position.
- The Row flyout → "Move row up" on a deep row moves exactly that row above the previous one.

## Edge cases

- Row 0 is unmounted at the decisive instant, proven from the live row indices, so the test cannot pass on an all-mounted table.
- The move preserves the row count and keeps the table's row keys in step with its rows; only the harmless gap in the off-window rows' childIds remains in the parity walk, and the gesture logs no page error.

## Notes

- Retired with the row handles: the autoscroll at the pointer's edge that mounted an off-window drop target mid-drag. Neither route that remains has a drop target to reach.
