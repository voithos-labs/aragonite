# Feature: Where the caret goes after a table edit

Every structural table edit puts the caret in a cell once it lands, and the next key you type goes
there. Each scenario types `x` straight after the edit and reads which cell it went into.

## Happy paths

- Insert row below (Ctrl+Enter): the new row's first cell, whatever column you were in
- Insert row above (Ctrl+Shift+Enter): the new row's first cell
- Insert column right (Alt+Shift+ArrowRight): the new column, on the row you were on
- Move row down (Alt+ArrowDown): the start of the cell you were in, now one row lower
- Move column right (Alt+ArrowRight): the start of the cell you were in, now one column over
- Delete row (Ctrl+Shift+Backspace): the row that slid into its place, same column
- Delete column (Alt+Shift+Backspace): the column that slid into its place, same row
- An alignment picked from the right-click menu: back at the start of the cell the menu opened on,
  with the menu gone
- A pasted spreadsheet grid (tab-separated text): the end of the grid's last cell

## Edge cases

- A 40-row grid pasted at the first cell of a table tall enough that its far rows aren't rendered
  yet: the row the grid ends on gets rendered, and `x` lands at the end of its last cell

## Miss-analysis

- The grid paste placed its caret through the table's own cell lookup, which only reaches rows
  already on screen, and every paste test used a table small enough to render whole, so a caret
  that never arrived went unseen.
