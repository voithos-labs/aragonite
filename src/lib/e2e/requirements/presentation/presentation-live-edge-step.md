# Feature: live-mode edge step (an arrow press that crosses a hidden edge)

Live mode hides a construct's markers, so the caret right after `bold` in `**bold**` stands for
two raw offsets: inside the closing `**` and past it. Typing picks one by how the caret arrived
(`presentation-live-typing-affinity.md`). A plain ArrowLeft or ArrowRight at such an edge moves
that pick one boundary per press before it moves the caret (`edge-step.ts`), and the construct
the next byte would join wears a faint ring (`md-edge-held`). A code span is the one construct
that shows its markers at the caret, so in prose the arrow steps over its backticks like any
other byte; a table cell keeps them hidden, so there the edge step does the work. Driven on
`/test/editor` via `?presentationMode=live` with real clicks and keys; each scenario checks the
source, and the ring by its class.

## Happy paths

- a code span ending a task item: a click at its end then `)` types inside; one ArrowRight
  steps over the closing backtick, and `)` lands past it in the same block
- a second ArrowRight leaves the block, landing at the next block's start
- ArrowLeft after that ArrowRight steps back inside: the byte lands before the backtick again
- the same holds mid-line: one ArrowRight types past the closer, the second moves the caret past
  the space
- it holds for every symmetric pair: code, bold, emphasis, strikethrough
- a leading edge mirrors it: ArrowLeft from the first content byte first steps outside the
  opener, and the byte lands before it

## Edge cases

- abutting closers take one press per run: at the end of `***both***`, one ArrowRight types
  between the `**` and the `*`, a second past both, a third leaves the block
- a link offers only its outside, so ArrowRight at its end moves the caret with no extra press
- Shift+ArrowRight at a hidden edge extends a range: it never stops there
- a table cell ending in a code span: one ArrowRight types past the backtick inside the cell,
  rather than moving to the next cell

## The ring

- a click at the end of `**scheduled**` rings the bold; one ArrowRight takes the ring away, and
  ArrowLeft brings it back
- at the end of `***both***` the ring goes from both constructs, to the emphasis alone, to none,
  one press at a time

## User interactions

- Real keyboard and real clicks only: the edge step is decided in the keydown, and the pixel
  never moves, so nothing but the bytes and the ring tell the two offsets apart

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)
