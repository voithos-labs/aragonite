# Feature: Opening a diagram's source keeps the reader's place

A rendered diagram is tall and its source card is short, so opening the source takes height out
of the document. At the end of the document the scroll container is already at its maximum, so
the removal necessarily scrolls it up by exactly what was removed, and by no more than that. The
card the user just asked for stays fully in view.

Fixture (loaded per test): forty filler paragraphs, then the showcase's own `xychart-beta`
diagram as the last block, scrolled to the bottom and focused. The fixture matters: a diagram
whose source is long enough to leave the card below the fold does not reproduce the problem,
because `focus()` on the textarea then scrolls it into view and rescues the position by
accident. The defect is invisible in exactly the geometries where the card is large.

## Happy paths

- Clicking the toolbar's Edit control scrolls the container up by exactly the height the swap
  removed, leaving it at its new maximum. The height it settles at is the document's, not a
  height the textarea passes through on its way there
- The source card is fully inside the scroll container afterwards: its top at or below the
  container's top, its bottom at or above the container's bottom

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
