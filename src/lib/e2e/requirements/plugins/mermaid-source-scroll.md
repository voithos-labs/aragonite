# Feature: Opening a diagram's source keeps the user's place

A rendered diagram is tall and its source card is short, so opening the source takes height out
of the document. At the end of the document the scroll container is already at its maximum, so
the removal necessarily scrolls it up by exactly what was removed, and by no more than that. The
card the user just asked for stays fully in view.

Fixture (loaded per test): forty filler paragraphs, then the showcase's own `xychart-beta`
diagram as the last block, scrolled to the bottom and focused. The fixture matters: the defect is
invisible where the source card is large, since the card then fills the space the swap freed.
The textarea's focus scrolls nothing either way; where the card opens is the kept position's job.

## Happy paths

- Clicking the toolbar's Edit control scrolls the container up by exactly the height the swap
  removed, leaving it at its new maximum. The height it settles at is the document's, not a
  height the textarea passes through on its way there
- The source card is fully inside the scroll container afterwards: its top at or below the
  container's top, its bottom at or above the container's bottom
- A diagram in the middle of a longer document, its lower half past the bottom edge: opening the
  source leaves the scroll position exactly where it was. Miss-analysis: every source-open test
  sat at the document's end, so nothing pinned that the textarea's focus after the kept position
  moves nothing

## Edge cases

- Each test asserts its preconditions before acting: the container really is at its maximum, the
  rendered diagram really is taller than a third of it, and the swap really did shrink the
  document, so a fixture that stops being tall or stops being at the end fails loudly instead of
  passing for want of anything happening

## Miss-analysis

- 2026-09 (#325): every mermaid spec loaded a three-block document that fits in the viewport, so
  no test ever opened a source under a scroll container with somewhere to fall. The general gap
  is that a render-primary block's view swap was only ever driven with the scroll position out
  of play, so the layout in between the mount and the final height was invisible to the suite.
- 2026-09: the forty paragraphs above sit under the size where windowing turns on, so this file
  never saw the long-document case; `view-swap-end-scroll.md` covers it
