# Feature: every Mod+A press shows something

Mod+A has two steps: the focused block's text, then the whole document. A press whose step would
change nothing, because the block has no text a caret reaches or the selection already holds all
of it, takes the next step, so the user never presses and sees nothing happen.

## Happy paths

- A caret on an empty paragraph (made by Enter), in live and source mode: one press selects the
  document.
- A caret on an empty list item (made by Enter), in live and source mode: one press selects the
  document.
- A caret on an empty quote line, in live and source mode: one press selects the document.
- A caret on an empty code body in live mode: one press selects the document. Source mode shows
  the fence lines as text, so its first press selects them.
- A paragraph already wholly selected with Shift+Home, in live and source mode: one press selects
  the document.
- A caret in an empty table cell: one press selects the document.
- A divider focused whole, which has no text: one press selects the document.

## Edge cases

- A cell with text: the first press selects the cell's text, without a range the editor holds, and
  the second selects the document.
- A paragraph holding only an image: the first press selects the image's paragraph, not the
  document.

## Miss-analysis

- Every select-all row started from a caret in a block with text, where the first step changes
  something, and the table cell planned its own two presses; no row pressed where the first step
  selects nothing.
