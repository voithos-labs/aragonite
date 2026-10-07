# Feature: a break key over a selection in one block

Select some text inside one block and press a key that breaks the line, and the selection goes first, the way Backspace would take it. The break then lands where the selection started, and it's always a break: a line the removal left empty doesn't count as the empty line Enter would leave the block from. Each row below runs in source mode and in live mode.

## Happy paths

- Enter over a selection in a paragraph: the selected text goes, and the paragraph splits where it was
  - Miss-analysis: every split test pressed Enter at a collapsed caret, so nothing saw the prose split at the caret and keep the selected text
- Shift+Enter over a selection in a paragraph: the selected text goes, and the hard break lands where it was
  - Miss-analysis: every hard-break test pressed Shift+Enter at a collapsed caret, the same gap as Enter's
- Enter and Shift+Enter over a selection in a heading: the same, and the heading keeps its `#`
- Enter and Shift+Enter over a selection in a code block: the selected text goes and a code line break takes its place (these already worked, and stay pinned)
- Shift+Enter over a selection in a table cell: the selected text goes and the cell's `<br>` takes its place
  - Miss-analysis: the cell's line break tests all pressed Shift+Enter at a caret, so nothing saw the `<br>` written beside a selection it should have replaced

## Edge cases

- Enter over the whole of a list item: the item stays and a new empty item opens below it, rather than the list ending there
  - Miss-analysis: every break-over-selection row selected a middle span, so nothing emptied the block before the command ran
- Enter over the whole of a code block's last line: a new line opens in the block and the caret stays inside, rather than leaving the code block
  - Miss-analysis: the same as the list item's; this one worked before the selection was taken out first, and nothing pinned it

- Enter in a table cell isn't a line break (it moves to the cell below, adding a row at the bottom of the table), so the selected text stays where it is

## User interactions

- One Ctrl+Z after Enter over a selection puts the selected text back, still selected, in one step, and redo breaks the line again
- Typing right after Enter over a selection lands at the start of the new line
