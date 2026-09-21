# Feature: Host-scroll (flow) mode, `scrollMode="host"`

The editor root stops being a scroll container and grows to its content; an ancestor on
the host's page owns the scroll. This is the embedding shape a journal page needs:
many small editors inside one scroller.

Host mode keeps the O(viewport) bound: the editor windows against the ancestor that
actually scrolls it, so a journal page holding a large entry mounts a slice like any
other. The one difference in behavior is scroll anchoring, which the activation
decides (`vr-page-scroll-anchor.md`).

Fixture: `/test/flow`, three journal entries in one scroller (1000px of filler above
and below), plus a pane that clips rather than scrolls, for the case where scrolling a
block into view has to report failure.

## Happy paths

- A 200-block entry in host mode windows: fewer blocks are mounted than the CST holds, and spacers render. The identical source loaded into a self-mode editor mounts a slice of the same order, so one implementation is demonstrably serving both scroll containers.
- An entry whose blocks are nested containers windows every child list: a 120-item list (a list rendered by a direct each, whose items hold block lists of their own) and a 120-row table (the grid), each long enough to turn windowing on by itself, mount fewer children than they hold. The entry is scrolled into the scroll container first: a list below the fold overlaps it by zero pixels and correctly mounts almost nothing (VR-11), which would pass the count for no reason. Typing inside a nested leaf reaches the source and raises no page error, and that edit drives the measure and subtotal path up through the stacked height tables.
- The editor root is not a scroll container in host mode (computed `overflow-y` is not `auto`/`scroll`, and its `scrollHeight` does not exceed its `clientHeight`); the ancestor scroller carries the entry's whole estimated height, with spacers standing in for the unmounted blocks, and scrolling it moves the entry.

## User interactions

- Typing into a block of a host-mode entry reaches the source, and Ctrl+Z reverts it: the edit and undo paths do not depend on the mode.
- Two entries in one scroller: each windows its own document against the shared scroll container, and typing into the second entry leaves the first entry's source untouched (no cross-instance interference).
- Ctrl+F with a block of an entry focused opens exactly one find bar, in that entry.
- A block drag held in the band at the bottom edge of the ancestor scroll container autoscrolls the ancestor. Autoscroll aimed at the editor root does nothing in host mode, since the root does not scroll, so a drag toward off-screen content would strand.
- With the find bar open, scrolling the ancestor past the entry's top edge keeps the bar at a constant offset from the editor root's own top: it travels with the entry rather than sticking to the ancestor's scroll container. (In self mode the bar is sticky at the top of the scroll container, which is what a host-scroll editor must not inherit: sticky resolves against the ancestor's scroll container once the root stops scrolling, floating the bar over unrelated page content.)

## Edge cases

- `rects.scrollTo` on a block far below the fold resolves `true` and the block ends up inside the ancestor's scroll container (the ancestor scrolled, not the root).
- `rects.scrollTo` on a path that addresses no block resolves `false`.
- `rects.scrollTo` past the edge of a host that clips rather than scrolls resolves `false`, while a block above that edge still resolves `true`. The case is the clip boundary, not distance: a block just past a short pane's bottom edge is still inside the window viewport, so neither the editor root (which spans the full document height in host mode) nor the window viewport can answer it. Visibility is measured against whatever scrolls or clips the editor.
- `setSelection` in host mode reports `true` only once the block is inside the ancestor's scroll container, and inherits the same clip bound (a restore into a clipped-out block reports `false`). Task 1's contract routes through the same in-view read, so the mode is one more thing that boolean depends on.

## Error cases

- No uncaught page errors surface during load, scroll, edit, or reveal in host mode.
