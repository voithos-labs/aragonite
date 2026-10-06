# Feature: Shift+ArrowUp and Shift+ArrowDown over a selection

Once you've selected something, the end you're moving is the one that decides which line you're on. The other end (the anchor) stays put and doesn't get a say. Every row runs in source and live mode.

## Edge cases

- A paragraph after a hard break, selected from line one to its end: Shift+ArrowDown extends into the next block
- A list item after a hard break, the same selection: Shift+ArrowDown extends into the block after the list
- A table cell holding `Left<br>Right`, selected from `Left` down into `Right`: Shift+ArrowUp moves the selection's end back up to `Left`, still inside the cell, instead of turning into a row selection
- The same cell, selected from `Left` to the cell's end: Shift+ArrowDown extends out of the table, as it does from a caret at the end

## Miss-analysis

Every Shift+Arrow row started from a caret, or from a selection whose two ends sat on one line, so the line check read the selection's start and still got the right answer. Only Shift+Home had a row with the ends on different lines, and it got its own fix instead of the shared one.
