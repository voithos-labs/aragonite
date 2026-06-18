# Feature: Keyboard cross-block selection — vertical-skip parity

Cross-block Shift+ArrowUp/Down must respect `isVerticallyTransparent()` the
same way single-block ArrowUp/Down dispatch does. Vertically-transparent
blocks (today: image-only paragraphs, and containers whose every child is
transparent) carry no caret-able column landing, so vertical extension
passes straight through them to the next concrete leaf.

Horizontal extension (Shift+ArrowLeft/Right) still stops at the widget
edge — vertical-skip is a vertical-only behavior.

## Happy paths

- Shift+ArrowDown across an image-only paragraph from collapsed entry:
  focus skips the transparent middle paragraph and lands at the start of
  the next concrete block (cross-block entry path).
- Shift+ArrowUp across an image-only paragraph from collapsed entry:
  focus skips the transparent middle paragraph and lands at the previous
  concrete block (cross-block entry path).
- Continued Shift+ArrowDown while cross-block is already active passes
  over a transparent paragraph in one keystroke (cross-block-active path).
- Continued Shift+ArrowUp while cross-block is already active passes over
  a transparent paragraph in one keystroke (cross-block-active path).
- Ctrl+Shift+End at a document whose last block is transparent lands the
  focus on the last text-bearing block, not on the transparent edge.
- Ctrl+Shift+Home at a document whose first block is transparent lands
  the focus on the first text-bearing block, not on the transparent edge.

## Off-window (windowed doc) — VR-6

- Ctrl+Shift+End in a windowed doc whose last block is an image-only
  paragraph that is currently OFF-window (unmounted): focus lands on the
  last text-bearing block, identical to the non-windowed result. The
  transparency decision must come from the CST node, not a mounted
  component — an unmounted transparent block must still be skipped.

## Container recursion

- Shift+ArrowDown from a paragraph above a list whose only items are
  image-only items lands focus past the list, on the paragraph below.
  The list (every child transparent) is itself transparent and is
  skipped entirely.

## Horizontal regression guard

- Shift+ArrowRight from the end of a paragraph that precedes an image-
  only paragraph: focus lands on the image-only paragraph (offset 0).
  Horizontal extension must not apply vertical-skip.
