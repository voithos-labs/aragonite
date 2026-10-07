# Feature: a break key over a selection in one block

Select some text inside one block and press a key that breaks the line, and the selection goes first, the way Backspace would take it. The break then lands where the selection started, and it's always a break: a line the removal left empty doesn't count as the empty line Enter would leave the block from. Each row below runs in source mode and in live mode.

## Happy paths

- Shift+Enter over a selection in a code block and in a table cell: the selected text goes and a code line break, or the cell's `<br>`, takes its place
  - Miss-analysis: the cell's line break tests all pressed Shift+Enter at a caret, so nothing saw the `<br>` written beside a selection it should have replaced

## User interactions

- One Ctrl+Z after Enter over a selection puts the selected text back, still selected, in one step, and redo breaks the line again
- Typing right after Enter over a selection lands at the start of the new line

## Pinned below the browser

Enter and Shift+Enter over a selection in a paragraph or heading, Enter in a code block, Enter in a table cell (it moves to the cell below and adds a row at the bottom, so the selected text stays), and Enter over the whole of a list item or a code block's last line (the item stays and a new empty one opens below it, and the caret stays inside the block) run against the mounted editor in `break-over-selection.test.ts` and `break-over-selection-exits.test.ts`, in both modes. Each already carries its own miss-analysis.
