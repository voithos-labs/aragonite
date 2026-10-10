# Feature: live-mode fresh start (Enter and a click past a line's end start plain)

In live mode a letter takes the format of the character before it. A fresh start is the exception:
the caret in a block Enter just made, or after a click in the blank space past a line's end, means
outside every format until it moves. So Enter after a bold word doesn't carry the bold into the new
block, and neither does a click past the end of a bold line. A click on the text itself still follows
the character before the caret. Driven on `/test/editor` via `?presentationMode=live` with real
clicks and keys; every scenario checks the source.

## Happy paths

- Enter at the end of a bold line, then a letter: the letter types plain in the new block
- Enter in the middle of a bold word, then a letter: the new block starts with the letter, plain,
  before the reopened bold (`X**ld**`), even though the text after it is bold
- A click in the blank space past the end of a line ending in bold, then a letter: plain
- A click on the bold word's last letter, then a letter: bold, since the character before the caret
  is bold

## Edge cases

- A drag that ends past the line's end isn't a click, so it sets nothing: the letter types bold

## User interactions

- Real clicks, a real drag and real keys only: the fresh start is set by the click and the split
  themselves, which a programmatic caret write would skip

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
