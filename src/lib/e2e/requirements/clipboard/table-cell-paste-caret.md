# Feature: Table cell paste — caret at end of pasted content

A structural paste into a table cell splits the table at the paste row and
splices the pasted blocks between the two halves. The post-paste caret follows
the editor's clipboard contract: focus lands at the end of the pasted content.

## Happy paths

- Multi-block clipboard pasted into a body cell: focus lands at the end of the
  LAST pasted block, not the first. Typing a character appends it there.

## Edge cases

- Single-block clipboard: the first and last pasted block coincide, so the caret
  lands on that one block regardless.
