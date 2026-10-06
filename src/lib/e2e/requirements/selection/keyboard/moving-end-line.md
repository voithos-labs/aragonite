# Feature: ArrowUp and ArrowDown over a selection

Once you've selected something, the end you're moving is the one that decides which line you're on, and which column the next line is aimed at. The other end (the anchor) stays put and doesn't get a say. That goes for the plain arrows too: they drop the selection and move from that same end, like the browser does inside one block. Every row runs in source and live mode.

## Edge cases

- A paragraph after a hard break, selected from line one to its end: Shift+ArrowDown extends into the next block
- A list item after a hard break, the same selection: Shift+ArrowDown extends into the block after the list
- A table cell holding `Left<br>Right`, selected from `Left` down into `Right`: Shift+ArrowUp moves the selection's end back up to `Left`, still inside the cell, instead of turning into a row selection
- The same cell, selected from `Left` to the cell's end: Shift+ArrowDown extends out of the table, as it does from a caret at the end

## User interactions

- Two one-line paragraphs, a forward selection over columns 1 to 9 of the first: ArrowDown lands in the second where a caret at column 9 would, not under column 1
- The same selection in the second paragraph: ArrowUp lands in the first where a caret at column 9 would
- A backward selection from column 9 to 1 of the first: ArrowDown lands where a caret at column 1 would

## Miss-analysis

Every Shift+Arrow row started from a caret, or from a selection whose two ends sat on one line, so the line check read the selection's start and still got the right answer. Only Shift+Home had a row with the ends on different lines, and it got its own fix instead of the shared one. The column had the same blind spot: no row pressed a plain arrow over a selection at all, and a probe with Shift+ArrowDown never reached it, since that key's first press inside a block is the browser's own.
