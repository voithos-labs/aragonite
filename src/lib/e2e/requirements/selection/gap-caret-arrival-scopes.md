# Feature: gap caret arrival outside a plain root slice

Two arrival cases the root's flat, fully mounted list cannot answer: a boundary inside a
container, and a boundary at the join a render window cuts. Root arrival and the exit keys
are in `gap-caret-arrival.md`.

## Happy paths

- A blockquote whose only child is a fence, sitting among root paragraphs: forward-Delete at
  the fence's closer rests at the boundary that ends the quote's own child list, addressed
  in the container's own index space. The next move is what tells the two rules apart: it
  leaves the container for the root block after it, where a stop computed against the root
  would land on the block after the boundary's root index instead.
- A boundary mid-document under virtual rendering: the caret rests there through the same
  gesture once the surrounding blocks are mounted, and the proxy element takes DOM focus.

## User interactions

- Real Delete keystrokes and real scrolls; block addressing goes through the test bridge
  because the chained locator costs minutes on a 200-block fixture.

## Known v1 narrowings

- Entering a container from outside lands on its deepest leaf and does not visit a gap at
  the end of the nested child list; only a move that starts inside that child list sees it.
- The dead-space click route lands root-level gaps only (`gap-caret-arrival.md`).
- **The windowed-join half of the block list's trailing branch is not pinned by a test.**
  That branch paints a boundary equal to the end of the mounted slice, which is either the
  end of a child list (covered here and by the container fixtures) or the join with an
  unmounted next block. Measured: sweeping the window across a 200-fence document never
  rests on that join, because the recompute moves the slice end past the boundary in one
  step and no scroll position holds it. The honest check is a block-list component test
  with a synthetic window, not a browser gesture.

## Miss-analysis

New behavior, not a regression. The child-list check exists because the most common bug
here is a rule computed against the wrong index space: the boundary and the landing agree
numerically at the root, so only a nested fixture whose container index differs from its
child index can tell a correct stop from a root-scoped one.
