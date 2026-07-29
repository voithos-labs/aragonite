# Feature: Page-scrolled host embedding — `scrollMode="host"` with no scrollable ancestor

The second host shape. `/test/flow` embeds host-mode editors in an ancestor scroller
and pins its page at 100vh; here nothing between the editor and the document scrolls,
so the window's own viewport is the scrollport. Every seam that asks "what scrolls
this editor" gets no element for an answer, which is the axis this fixture exists to
exercise.

Fixture: `/test/page-scroll` — one 160-block entry in host mode, 400px of filler above
and below, and a zero-height `<img>` above the entry whose `src` the spec sets to give
it an intrinsic size (the image-decode stall, on demand).

## Happy paths

- No ancestor between the editor root and the body is user-scrollable, the root's own
  computed `overflow-y` is `visible` and it does not overflow itself, and the
  document's scroll height exceeds the entry's — the page carries the entry.
- Scrolling the window moves the entry's blocks by the scrolled amount.
- Windowing never activates: every top-level block is mounted and no `.vr-spacer`
  renders. (Host mode disables it statically — with no scrollport of its own the
  height model would read the root's whole content height as the viewport and a local
  scroll offset of 0, and mount everything regardless.)

## Edge cases

- `rects.scrollTo` on a block far below the fold resolves `true`, moves the WINDOW's
  scroll offset off zero, and lands the block inside the window viewport.

## Error cases

- No uncaught page errors surface during load, scroll, or reveal.
