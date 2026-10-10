# Feature: live-mode edge step (an arrow press that crosses a code chip's border)

Live mode hides a construct's markers, so the caret right after `code` in `` `code` `` stands for
two raw offsets: inside the closing backtick and past it. A code chip has a painted box, so those
are two caret stops a step apart: a plain ArrowLeft or ArrowRight at the chip's edge moves the
typing offset across the border before it moves the caret (`edge-step.ts`). A mark (bold, italic,
strikethrough) has no box, so it has no stop: the arrow moves the caret like anywhere else, and
the next letter takes the format of the character before it. The chip carries a faint ring
(`md-edge-held`) while the caret sits inside its edge. Driven on `/test/editor` via
`?presentationMode=live` with real clicks and keys; each scenario checks the source, and the ring
by its class (one row also by what it draws).

## Happy paths

- a code span ending a task item: a click at its end then `)` types inside; one ArrowRight
  moves past the hidden closing backtick, and `)` lands past it in the same block
- a second ArrowRight leaves the block, landing at the next block's start
- ArrowLeft after that ArrowRight steps back inside: the byte lands before the backtick again
- the same holds mid-line: one ArrowRight types past the closer, the second moves the caret past
  the space
- bold, italic and strikethrough have no stop: one ArrowRight at the end moves the caret past
  the space, and the letter typed there lands after it
- at the leading edge of a bold, walked back to its first content byte, a letter types outside,
  since the character before the caret is the space

## Edge cases

- abutting closers have no stop either: at the end of `***both***` a letter types inside both,
  and one ArrowRight leaves the block
- where two constructs of one kind meet (`a _bold_*more* b`, `a __bold__**more** b`), the letter
  at the end of `bold` joins `bold`, the construct before the caret
- a link offers only its outside, so ArrowRight at its end moves the caret with no extra press
- Shift+ArrowRight at a hidden edge extends a range: it never stops there
- a plain ArrowRight at the end of a line ending in bold leaves the block
- a table cell ending in a code span: one ArrowRight types past the backtick inside the cell,
  rather than moving to the next cell

## The ring

- the ring actually shows, not just its class: at the end of a code span alone on its line and a
  code span mid-line, the chip draws the ring's colour around itself, in the light theme and the
  dark one, and that colour isn't the chip's own border. Miss-analysis: every ring row read the
  class, and the code chip's own border rule outranked the ring's, so the class was there while
  nothing drew it

## A code span's backticks

- live never shows a code span's backticks, in prose or in a table cell: with the caret at the
  span's end they stay hidden, and the ring marks the code instead. Miss-analysis: the reveal
  that showed them was code-only, and every code-span row checked bytes, which the edge step
  lands the same way over hidden backticks, so nothing pinned which cue live gives

## User interactions

- Real keyboard and real clicks only: the edge step is decided in the keydown, and at a chip's
  edge the caret doesn't move on the first press, so only the bytes and the ring tell the two
  offsets apart

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)
