# Block: List, Home

Home goes to the start of the line the caret is on. A list item's first line starts behind its
marker (`- `, `1. `, a task box), so Home there stops right after the marker, where the text
starts. Every line below it, whether after a Shift+Enter break or a long item wrapping, starts
where the browser says it does. Source and live mode, each row.

Miss-analysis: every Home test started on a one-line item, where the item's start and the line's
start are the same place, so a Home that always went to the item's start passed all of them (#691).

## Happy paths

- `- abc def\` over `e.g.`, caret in `e.g.`, Home: the caret lands at the start of `e.g.`, and a
  Backspace from there keeps the item a list item.
- A long item that wraps, caret on its last line, Home: the caret lands at the start of that
  line, on the same line, right after a space.

## Edge cases

- Home on the item's first line still stops after the marker: typing `X` gives `- Xabc def\`.

## User interactions

- Shift+Home from the end of `e.g.` selects exactly `e.g.`.
- Shift+Home from inside `abc def` on the first line selects back to the text start, and the
  marker isn't part of the selection.
