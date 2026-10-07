# Feature: A shrinking view swap at the end of a long document keeps you at the end

You're at the bottom of a long document and a block down there swaps to a shorter view: a
diagram opens its source card, a details block collapses. The document just got shorter, so the
scroll position has to come up by exactly what the block lost, and not a pixel more. The block
stays in view.

The long part matters. Past a few screens the editor only mounts the blocks near the viewport
(windowing), and when the scroll comes up it mounts the blocks now in reach, one at a time.
Anything that reads the layout in between sees a list that's missing the rest of them, and the
browser pulls the scroll up to fit that shorter list and never gives it back (VR-16).

Fixture: a hundred and fifty blocks of paragraphs, quotes and lists (the quotes and lists matter,
each one lays out its own list as it mounts), then the swapping block last. Run in the plugins
harness with the editor scrolling itself and again with the page box around it scrolling
(`?scroll=host`), plus the showcase at `/` as is. Every test gets to the bottom with the mouse
wheel, in short steps, so every block on the way is measured. One more document ends inside a
three-hundred-item list, with the diagram in its last item, so the blocks that mount are that
list's own items rather than the document's.

## Happy paths

- The diagram's Edit button: the scroll container ends at its new bottom and the source card is
  fully in view
- A double click on the diagram: the same. It opens the source through the Edit button's own
  path, so it runs on the showcase only
- Collapsing an open details block with its toggle: the same
- The Edit button on a diagram in the last item of a long list: the same, in both scroll modes
- The first two on the showcase itself, which is where this was reported

## Edge cases

- Each test checks its setup before acting: the document really is windowed, the container
  really is at its bottom, and the swap really takes over 100px out of the document, so a fixture
  that stops doing any of those fails instead of passing for nothing

## Miss-analysis

- 2026-09 (#325): every mermaid spec loaded a three-block document that fits in the viewport, so
  no test ever opened a source under a scroll container with somewhere to fall. The general gap
  is that a render-primary block's view swap was only ever driven with the scroll position out
  of play, so the layout in between the mount and the final height was invisible to the suite.
- 2026-09: the one test of this (`mermaid-source-scroll.md`) used forty short paragraphs, under
  the size where windowing turns on, so no swap was ever driven at the end of a windowed
  document. The same gap hid the details collapse, which no test drove at the end at all
- 2026-09: every list in the first fixture had two items, so no test ever ended inside a list
  long enough to window its own items, and a list that forgot to hold its box passed everything
- A long table at the end isn't here on purpose: its rows mount without reading the layout, so
  emptying its last cell ends at the bottom with or without the table's own hold
