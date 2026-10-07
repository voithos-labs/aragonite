# Feature: Opening a diagram's source keeps the user's place

A rendered diagram is tall and its source card is short, so opening the source takes height out
of the document. In the middle of a document nothing has to move: the page stays where it was.
At the end of one the scroll container has to come up by exactly the height the swap removed,
and `view-swap-end-scroll.md` holds those cases.

Fixture: forty filler paragraphs, the showcase's own `xychart-beta` diagram, then forty more,
scrolled so the diagram's top sits two thirds of the way down the scroll container and its lower
half runs off the bottom edge.

## Happy paths

- A click in the diagram's visible top, then its Edit control: the textarea takes focus and the
  scroll position is exactly what it was after the click. Miss-analysis: every source-open test
  sat at the document's end, so nothing pinned that the textarea's focus after the kept position
  moves nothing

## Edge cases

- The test checks its setup before acting: the diagram really does start inside the scroll
  container and really does run past its bottom edge, so a fixture that stops doing either fails
  instead of passing for want of anything happening
