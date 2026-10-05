# Feature: live-mode edge step (an arrow press that crosses a hidden edge)

Live mode paints no delimiter, so the caret after `scheduled` in `` `scheduled` `` stands for
two raw offsets: inside the closing backtick and past it. Typing picks one by how the caret
arrived (`presentation-live-typing-affinity.md`), and until now nothing but End or the closer
itself could pick the outside: at the end of a line, ArrowRight walked straight into the next
block. A plain horizontal arrow at such an edge now moves the typing offset, not the caret, one boundary
per press (`edge-step.ts`), and the construct the next byte would join wears a ring
(`md-edge-held`). Driven on `/test/editor` via `?presentationMode=live` with real clicks and
keys; the source is what each scenario checks, and the ring is checked by its class.

## Happy paths

- a code span ending a task item: a click at its end then `)` types inside; one ArrowRight
  first types `)` past the backtick, in the same block
- a second ArrowRight from outside leaves the block as before, landing at the next block's start
- ArrowLeft after that ArrowRight steps back inside: the byte lands before the backtick again
- the same holds mid-line: one ArrowRight types past the closer, the second moves the caret past
  the space
- the rule reaches every symmetric pair: bold, emphasis, strikethrough
- a leading edge mirrors it: ArrowLeft from the first content byte first steps outside the
  opener, and the byte lands before it

## Edge cases

- abutting closers take one press per run: at the end of `***both***`, one ArrowRight types
  between the `**` and the `*`, a second past both, a third leaves the block
- a link offers only its outside, so ArrowRight at its end moves the caret with no extra press
- Shift+ArrowRight at the edge extends a range as before: it never stops at a hidden edge
- a table cell ending in a code span: one ArrowRight types past the backtick inside the cell,
  where the arrow used to move to the next cell

## The ring

- a click at a code span's end rings the span; one ArrowRight takes the ring away
- at the end of `***both***` the ring goes from both constructs, to the emphasis alone, to none,
  one press at a time
- the ring goes when the caret leaves the edge

## User interactions

- Real keyboard and real clicks only: the edge step is decided in the keydown, and the pixel
  never moves, so nothing but the bytes and the ring tell the two offsets apart

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)
