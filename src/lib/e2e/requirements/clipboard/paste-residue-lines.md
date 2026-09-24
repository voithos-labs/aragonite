# Clipboard: a multi-block paste keeps the lines after the caret

A paste of several blocks splits the paragraph at the caret. Everything after the caret stays, however many lines it runs to.

## Happy paths

- `abc\nAfter\n`, caret at the end of `abc` (End from the paragraph start), paste `x\n\ny`: the source is `abc\n\nx\n\ny\nAfter\n`; `After` stays after the pasted blocks, the line break before it where it was.
- The same paste of `> q`: `After` stays, as a line of the quote (`abc\n\n> q\nAfter\n`), which is how a reload reads those bytes.

## Caret placement

- After the paste, a typed character lands at the end of the pasted `y`, before the line break that leads to `After`.

## Undo

- One Ctrl+Z after the paste gives back `abc\nAfter\n`.

## Miss-analysis

- GH #436: every residue pin cut a one-line paragraph, so no paste put a line break after the caret; only the first block of the text after the caret was parsed, and the lines past it were dropped. Convergence passed, since the shortened document is a valid tree of its own.
