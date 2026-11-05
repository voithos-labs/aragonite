# Feature: Text over a range that ends at a picture's edge replaces the range

A range across blocks can end at either edge of a paragraph holding only a picture, where the
caret the range parks has no text beside it. Text that arrives there replaces the range the same
as anywhere else: by key, by soft keyboard, or by an IME.

## Happy paths

- `alpha`, `beta`, then a picture alone on its line. Click at the end of `alpha`, Shift+click at the
  picture's end, type `Z`: the document is `alphaZ`.
- The same range drawn by keyboard, from the end of `alpha` to the document's end (Ctrl+Shift+End,
  Cmd+Shift+Down on a Mac), then `Z`: the document is `alphaZ`.
- The same, Shift+click at the picture's start: the document is `alphaZ` and then the picture,
  joined on one line.
- Click in `alpha`, Ctrl+A twice, so the range covers the document and ends on the picture, type
  `Z`: the document is `Z`.

## Edge cases

- Each range above with `Z` sent the way a soft keyboard sends it (no keydown): the same bytes.
- Each range above with `Z` composed and committed through an IME: the same bytes.

## User interactions

- After each, no range is painted, and one Ctrl+Z puts the document back as it was.

Miss-analysis: every typed-over-range test ended the range in text, so the block's own keydown write
beside a widget, which took the key before the range saw it, never ran under a range.
