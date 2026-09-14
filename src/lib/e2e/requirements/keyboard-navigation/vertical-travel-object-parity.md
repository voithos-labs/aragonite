# Feature: vertical arrow travel past an object block

A block carrying no text column (an image-only paragraph, a lone formula, a lone footnote
reference) is a stop for vertical travel wherever it can be entered as an object: one ArrowUp
enters it, selecting an image or opening the source of a reveal-capable kind, and the next moves
on. ArrowDown reads it the same way. Both vertical directions must agree, or a run of ArrowUps
followed by the same number of ArrowDowns leaves the caret somewhere else.

A step-over widget (a decoded entity, an emoji shortcode) carries a column instead, so a paragraph
holding only one is a caret stop rather than an object stop: the arrival seats the caret beside the
glyph, the seat a horizontal step across it already lands on, instead of taking the widget as an
object. The count is the same, one press in and one press out, both directions.

Miss-analysis: the vertical arms were tested only where the object block sat between plain
paragraphs in one scope, so the two doors a vertical arrival crosses, the per-block landing and a
container's column entry, were never compared against each other, and each carried its own answer.

Miss-analysis: a caret beside an atomic island has no rect of its own, and the visual-line
predicates' offset fallback was unit-tested only with the caret inside a text node, the one shape
Chromium always measures; the e2e walks crossed only image blocks, where entering the object
replaces the caret, so nothing ever pressed Down on a seated caret with no rect.

## Happy paths

- ArrowUp from below a details-wrapped image up to the paragraph above, then the same number of
  ArrowDowns: the caret returns to the paragraph it started in.
- ArrowDown from the paragraph above an entity-only paragraph stops in it once and leaves on the
  next press; ArrowUp from below takes the same two presses.

## Edge cases

- The image is selected on exactly one press of the upward walk, and on exactly one press of the
  downward walk.
- Two adjacent entities, and a list item holding one entity-only paragraph, count the same as a
  lone entity. An entity followed by prose is an ordinary text block and counts the same.
- A caret stepped over the glyph by ArrowRight leaves the block on the first vertical press, up or
  down. A caret stepped between two adjacent glyphs, which touches no text node on either side,
  reads the same.
