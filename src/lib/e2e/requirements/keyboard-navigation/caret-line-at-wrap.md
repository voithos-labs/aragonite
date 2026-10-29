# Keyboard navigation: the caret's line at a soft wrap

Where a line wraps, one spot in the text is both the end of one visual line and the start of the
next, and the browser remembers which one the caret is showing. Measuring the spot gives the same
answer either way, so the editor asks the browser instead whenever the answer decides something: an
arrow leaving the block, Home on a list item's first line, a soft-line delete. Every row fixes the
editor's width, so the paragraph wraps the same way on every engine, and runs on Chromium, Firefox
and WebKit.

## What the browser does with the question

- End on a line, then asking where the line ends: the caret doesn't move, and the next ArrowDown
  goes where it would have gone without the question
- Home on the next line, then asking where the line ends and going back to its start: the caret is
  back on the same line's start (Shift+Home after it selects nothing), and ArrowDown goes where it
  would have gone without the question
- the same in a list item, and with an image starting the next line (a picture wider than what
  line 1 leaves). Chromium marks the asked row `fixme` against #574: its line start skips a picture
  opening a wrapped line, so the way back lands after the picture
- End on a short line 1 of a two-line paragraph, ArrowDown: the caret lands on line 2 at line 1's
  column, inside the block, so the question left the caret on line 1's end
- End on a long line, then ArrowDown twice, through a short line that ends at a wrap: the second
  ArrowDown lands at the long line's column, the one the browser keeps for a run of arrows
- after an arrow at a wrap that asks the question, no selection toolbar shows, the selection is
  collapsed, no undo step is added, and one caret shows, on the line the browser shows it

## Happy paths

In a paragraph between two one-line blocks, and in a list item between them:

- click at the start of line 2, ArrowUp: the caret moves to line 1, inside the block
- Home on line 2, ArrowUp: the caret moves to line 1, inside the block
- End on the second-to-last line, ArrowDown: the caret moves to the last line, inside the block
- Home on the last line, ArrowDown: the caret leaves for the block after, near its start, since it
  left from the start of a line
- End on line 1, ArrowUp: the caret leaves for the block before, past its middle, since it left
  from the end of a line

Beside a space, the caret is on one line only, so nothing is asked (and no dev check fires):

- End, then ArrowLeft on line 1, which puts the caret before the space the line wraps at, ArrowUp:
  the caret leaves for the block before
- End, then ArrowLeft on the second-to-last line, ArrowDown: the caret moves to the last line,
  inside the block
- after the space past a picture that opens line 2, ArrowUp: the caret moves to line 1, inside the
  block (the letters either side of it sit on two lines, but the space puts it on line 2 alone)

## With Shift

- Home on line 2, Shift+ArrowUp: the selection runs from line 2's start up onto line 1, inside the
  block
- End on the second-to-last line, Shift+ArrowDown: the selection runs onto the last line, inside the
  block
- a range already held from the middle of line 2 back to its start, Shift+ArrowUp: the anchor stays
  put and the focus moves up onto line 1
- a range already held from the middle of the second-to-last line to its end, Shift+ArrowDown: the
  anchor stays put and the focus moves onto the last line
- a range held from line 1 down to line 2's start, then Shift+ArrowDown: the focus lands on line
  3's start; a range held from line 1 down to line 3's start, then Shift+ArrowUp: on line 2's
  start. The focus reaches each start by Shift+ArrowDown, then Shift+ArrowLeft back to it (on a Mac
  Shift+Cmd+ArrowLeft moves a forward range's start, and a Shift+arrow stops at the anchor rather
  than cross it). A held range is never asked which line it's on, so the browser's column stays
  as it was
- the first two in a wrapped table cell, where the first Shift+arrow at the cell's top or bottom
  line would take a whole row instead: the selection stays inside the cell; and both held ranges

## A soft-line delete

The Mac's Cmd line delete, sent the way `collapsed-delete-class.spec.ts` sends it:

- Home on line 2, Cmd+Backspace: line 1 stays whole and one character goes, the space before line 2
- Home on line 2, Cmd+Delete: line 2's run goes, line 1 stays whole

## Not in this file

- a plain ArrowUp or ArrowDown in a table cell moves to the next cell whatever line the caret is on,
  so a cell's plain rows say nothing about the wrap (`blocks/table/navigation.md`)

## Miss-analysis

- Every vertical-motion row started from a caret the harness placed or from a line with no wrap,
  so no row ever stood on the one spot where a measured caret and the browser's disagree.
- The run of ArrowDown through a short line's end (Firefox landed at the short line's column): every
  row pressed one arrow after the question, so none watched the browser's own column across a run.
- The caret beside a space (before a wrap's space, or after one past a picture opening a line):
  every row stood on the wrap itself, so none checked that a spot on one line only isn't read as a
  wrap; there Up and Down left from the wrong line, and asking fired the dev check.
