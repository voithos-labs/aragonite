# Feature: a gesture in an editable's top padding lands at the column below

A code block's grey box, a paragraph and a table cell each keep some padding above their
first line. A pointer gesture that ends there resolves as if it ended on that first line,
at the column under the pointer, on every OS. Chromium on Mac and Linux answers a point
above the first line with that line's start, so the editor moves the point onto the line
before it asks.

## Happy paths

- Drag from `Be|fore` in the paragraph above and release in a code block's top padding
  (live): the range ends at `con|st`, the column under the release.
- Press in a code block's top padding and drag up to `Be|fore`: the range starts at
  `con|st`.
- With the caret at `Be|fore`, Shift+click in a code block's top padding: the range ends at
  `con|st`.
- The same three gestures in a paragraph's top padding: the range's end there is `Hel|lo`.

## Edge cases

- A range that reaches a table from outside it names whole cells, so a drag or Shift+click
  into a cell's padding has no column to keep; only a plain click in a cell does.

## User interactions

- A plain click in a code block's, a paragraph's or a table cell's top padding lands the
  caret at the column under it. The browser places that press itself, so these rows wait
  on the next slice (`test.fixme` in the spec).

## Miss-analysis

- Only the nearest-offset lookup moved a padding point onto a line; a drag's end, the press
  that starts a drag and a Shift+click ask through the exact lookup, which no test aimed at
  padding, and the suite only ran on Windows, where the browser keeps the column anyway.
