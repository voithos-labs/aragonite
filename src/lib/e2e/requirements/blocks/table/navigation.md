# Feature: Table block — keyboard navigation

## Happy paths

- Tab from a non-last cell moves to the next cell (right; wraps to next row's first cell).
- Shift+Tab from a non-first cell moves to the previous cell (left; wraps to previous row's last cell).
- Tab from the last cell of the last row creates a new empty row and focuses its first cell.
- ArrowLeft at offset 0 of a cell moves to the end of the previous cell.
- ArrowRight at end of cell moves to the start of the next cell.
- ArrowUp / ArrowDown move to the cell directly above / below in the same column. Both directions land the caret at the start of the target cell — symmetric so a press-and-press-back round-trip restores the original cursor position.
- ArrowDown from the bottom row exits the table downward into the next block; the caret lands at the sticky-X column on the next block's first visual line, matching how vertical navigation works between paragraphs.
- ArrowUp from the top row exits the table upward into the previous block; the caret lands at the sticky-X column on the previous block's last visual line.
- Backspace at offset 0 of a cell navigates to end of previous cell (no content deleted).
- Backspace at offset 0 of the first cell of the first row exits the table upward.
- Enter in a non-last row moves to the cell directly below in the same column.
- Enter in the last row creates a new empty row and focuses its first cell.

## Edge cases

- Sticky-column hand-off: paragraph above table → ArrowDown → land in the cell whose horizontal range contains the previous pixel-X.
- Inside-table vertical movement preserves the column index, ignoring the editor's pixel-X.
- Exiting the table downward captures pixel-X into the editor sticky and lands the cursor at the corresponding column in the next block.

## Error cases

- Tab on a table with only one cell still creates a new row on Tab from that cell.
