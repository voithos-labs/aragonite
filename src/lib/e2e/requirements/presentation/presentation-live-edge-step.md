# Feature: live-mode edge step (an arrow press that crosses a hidden edge)

Live mode hides a construct's markers, so the caret right after `bold` in `**bold**` stands for
two raw offsets: inside the closing `**` and past it. Typing picks one by how the caret arrived
(`presentation-live-typing-affinity.md`). A plain ArrowLeft or ArrowRight at such an edge moves
that pick one boundary per press before it moves the caret (`edge-step.ts`), and the construct
the next byte would join wears a faint ring (`md-edge-held`). A code span's backticks are
hidden markers like any other, in prose and in table cells. Driven on
`/test/editor` via `?presentationMode=live` with real clicks and keys; each scenario checks the
source, and the ring by its class.

## Happy paths

- a code span ending a task item: a click at its end then `)` types inside; one ArrowRight
  moves past the hidden closing backtick, and `)` lands past it in the same block
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

## A code span's backticks

- live never shows a code span's backticks, in prose or in a table cell: with the caret at the
  span's end they stay hidden, and the ring marks the code instead. Miss-analysis: the reveal
  that showed them was code-only, and every code-span row checked bytes, which the edge step
  lands the same way over hidden backticks, so nothing pinned which cue live gives

## User interactions

- Real keyboard and real clicks only: the edge step is decided in the keydown, and the pixel
  never moves, so nothing but the bytes and the ring tell the two offsets apart

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)
