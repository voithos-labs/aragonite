# Feature: vertical arrow travel past an object block

A block carrying no text column (an image-only paragraph, a lone formula, a lone footnote
reference) is a stop for vertical travel wherever it can be entered as an object: one ArrowUp
enters it, selecting an image or opening the source of a reveal-capable kind, and the next moves
on. ArrowDown reads it the same way. Both vertical directions must agree, or a run of ArrowUps
followed by the same number of ArrowDowns leaves the caret somewhere else.

Miss-analysis: the vertical arms were tested only where the object block sat between plain
paragraphs in one scope, so the two doors a vertical arrival crosses, the per-block landing and a
container's column entry, were never compared against each other, and each carried its own answer.

## Happy paths

- ArrowUp from below a details-wrapped image up to the paragraph above, then the same number of
  ArrowDowns: the caret returns to the paragraph it started in.

## Edge cases

- The image is selected on exactly one press of the upward walk, and on exactly one press of the
  downward walk.
