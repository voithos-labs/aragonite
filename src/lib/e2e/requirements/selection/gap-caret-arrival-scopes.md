# Feature: gap caret arrival outside a plain root slice

Two arrival cases the root's flat, fully-mounted list cannot answer: a boundary INSIDE a
container, and a boundary at the seam a render window cuts. Root arrival and the exit keys
are `gap-caret-arrival.md`.

## Happy paths

- A blockquote whose only child is a fence, sitting among root paragraphs: forward-Delete at
  the fence's closer parks at the QUOTE's scope-end boundary, addressed in the container's
  own index space. The discriminator is the next move — it leaves the container for the root
  block AFTER it, where a stop computed against the root would land on the block after the
  boundary's root index instead.
- A boundary mid-document under virtual rendering: the caret parks there through the same
  gesture once the neighbourhood is revealed, and the proxy takes DOM focus.

## User interactions

- Real Delete keystrokes and real scrolls; block addressing goes through the test bridge
  because the chained locator costs minutes on a 200-block fixture.

## Known v1 narrowings

- Entering a container from OUTSIDE lands its deepest leaf as before and does not visit a
  nested scope-end gap; only a move that starts inside the scope sees it.
- The dead-space click route lands root-level gaps only (`gap-caret-arrival.md`).
- **The windowed-seam half of the block list's trailing branch is unpinned.** That branch
  paints a boundary equal to the slice end, which is a scope end (covered here and by the
  container fixtures) or the seam with an unmounted next block. Measured: sweeping the
  window across a 200-fence document never rests on the seam — the recompute moves the
  slice end past the boundary in one step, so no scroll position holds it. The honest oracle
  is a block-list component test with a synthetic window, not a browser gesture.

## Miss analysis

New behavior, not a regression. The scope discriminator exists because the dominant local
bug class is a rule computed against the wrong index space: the boundary and the landing
agree numerically at the root, so only a nested fixture whose container index differs from
its child index can tell a correct stop from a root-scoped one.
