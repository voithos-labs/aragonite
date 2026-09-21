# Feature: Page-scrolled host embedding: `scrollMode="host"` with no scrollable ancestor

The second host shape. `/test/flow` embeds host-mode editors in an ancestor scroller
and holds its page at 100vh; here nothing between the editor and the document scrolls,
so the window's own viewport is the scroll container. Every piece of code that asks
"what scrolls this editor" gets no element for an answer, which is what this fixture
exists to exercise, windowing included, since the editor now windows against whatever
scrolls it rather than switching off.

Fixture: `/test/page-scroll`, one host-mode entry, 400px of filler above and below,
and two late-sizing growers for the anchoring cases (see `vr-page-scroll-anchor.md`).
`?blocks=` sizes the entry across the windowing threshold; the default clears it.
The 400px of filler above the entry is needed rather than decorative: it puts
the editor at a nonzero offset inside the scroll container's content, which is the
extra coordinate step host-mode windowing adds.

## Happy paths

- No ancestor between the editor root and the body is user-scrollable, the root's own
  computed `overflow-y` is `visible` and it does not overflow itself, and the
  document's scroll height exceeds the entry's, so the page carries the entry.
- Past the threshold, windowing activates: fewer top-level blocks are mounted than the
  CST holds, and spacers stand in for the rest.
- Scrolling the window moves the window over the document: a later, contiguous band
  mounts, still bounded rather than accumulating behind the user.
- Under the threshold the same embedding never activates: every block mounts and no
  `.vr-spacer` renders. The budget is the only check, so a small embedded document pays
  nothing for the feature.

## Edge cases

- `rects.scrollTo` on a block far below the fold resolves `true`, moves the window's
  scroll offset off zero, and lands the block inside the window viewport.
- A search jump to a match in a windowed-out block mounts it and scrolls the page to
  it. The scroll settles over several flushes, so visibility is polled.
- Undo whose target block has been windowed out mounts and scrolls to the target before
  landing the caret: the block mounts, sits at the top of the viewport, and the edit is undone.
- A point below the whole document (`placeCaretAtPoint`, where a shell's own
  below-the-editor handler sends one) resolves against the CST, not the rendered
  slice: it lands in the last parsed block, mounting it first. The two agreed before
  host-mode windowing only because nothing was ever left unmounted below the
  mounted tail (#72).

## Error cases

- No uncaught page errors surface during load, scroll, scrolling a block into view, or
  the below-document landing.
