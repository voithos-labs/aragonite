# Feature: Opening a diagram's source keeps the reader's place

A rendered diagram is tall and its source card is short, so opening the source removes height
from the document. At the document's END the scrollport is already at its maximum, and the
removal necessarily scrolls it up by exactly what was removed, but by no more than that. The
card the user just asked for stays fully in view.

Fixture (loaded per test): forty filler paragraphs, then the showcase's own `xychart-beta`
diagram as the last block, scrolled to the bottom and focused. The fixture is load-bearing: a
diagram whose SOURCE is long enough to leave the card below the fold does NOT reproduce, because
`focus()` on the textarea then scrolls it into view and rescues the position by accident. The
defect is invisible in exactly the geometries where the card is large.

## Happy paths

- Clicking the toolbar Edit control scrolls the port up by exactly the height the swap removed,
  leaving it at its new maximum. The card's fitted height is the document's, not the height the
  textarea passes through on its way there
- The source card is fully inside the scrollport afterwards: top at or below the port's top,
  bottom at or above the port's bottom

## Edge cases

- The precondition each test asserts before acting: the port really is at its maximum, the
  rendered diagram really is taller than a third of the port, and the swap really did shrink the
  document, so a fixture that stopped being tall or stopped being at the end fails loudly
  instead of passing vacuously

## Miss-analysis

- 2026-09 (#325): every mermaid spec loaded a three-block document that fits in the viewport, so
  no test ever opened a source under a scrollport that had somewhere to fall. The generalized
  gap: a render-primary block's view swap was only ever driven with the scroll position out of
  play, so the transient layout between mount and fitted height was invisible to the suite.
