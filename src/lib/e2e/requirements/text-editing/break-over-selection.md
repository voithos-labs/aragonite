# Feature: a break key over a selection in one block

Select some text inside one block and press a key that breaks the line, and the selection goes first, the same as if you'd typed over it. The break then lands where the selection started. Each row below runs in source mode and in live mode.

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

- Enter in a table cell isn't a line break (it moves to the cell below, adding a row at the bottom of the table), so the selected text stays where it is

## User interactions

- One Ctrl+Z after Enter over a selection puts the selected text back, in one step
- Typing right after Enter over a selection lands at the start of the new line
