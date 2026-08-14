# Feature: Host-scroll (flow) mode — `scrollMode="host"`

The editor root stops being a scrollport and grows to its content; an ancestor on
the host's page owns the scroll. This is the embedding shape a journal page needs:
many small editors inside one scroller.

Host mode keeps the O(viewport) bound: the editor windows against the ancestor that
actually scrolls it, so a journal page holding a large entry mounts a slice like any
other. The one behavioural difference is scroll anchoring, which the activation
decides (`vr-page-scroll-anchor.md`).

Fixture: `/test/flow` — three journal entries in one scroller (1000px of filler above
and below), plus a pane that CLIPS rather than scrolls, for the honest-reveal arm.

## Happy paths

- A 200-block entry in host mode windows: fewer blocks are mounted than the CST holds, and spacers render. The identical source loaded into a self-mode editor mounts a slice of the same order, so one implementation is demonstrably serving both ports.
- An entry whose blocks are nested containers windows every scope: a 120-item list (a direct-each scope whose items are themselves BlockList-bearing scopes) and a 120-row table (the grid scope), each over the watermark on its own, mount fewer children than they hold. The entry is scrolled into the port first — a scope below the fold intersects it in zero pixels and correctly mounts almost nothing (VR-11), which would pass the census for no reason. Typing inside a nested leaf reaches the source and raises no page error — that edit drives the measure/subtotal path up through the stacked models.
- The editor root is not a scroll container in host mode (computed `overflow-y` is not `auto`/`scroll`, and its scrollHeight does not exceed its clientHeight); the ancestor scroller carries the entry's whole modeled height — spacers standing in for the windowed-out blocks — and scrolling it moves the entry.

## User interactions

- Typing into a block of a host-mode entry reaches the source, and Ctrl+Z reverts it — the edit and undo paths are mode-independent.
- Two entries in one scroller: each windows its own document against the shared port, and typing into the second entry leaves the first entry's source untouched (no cross-instance interference).
- Ctrl+F with a block of an entry focused opens exactly one find bar, in that entry.
- A block drag held in the ancestor scrollport's bottom edge band autoscrolls the ANCESTOR. Autoscroll targeting the editor root is inert in host mode — the root doesn't scroll — so a drag toward off-screen content would strand.
- With the find bar open, scrolling the ancestor past the entry's top edge keeps the bar at a CONSTANT offset from the editor root's own top — it rides the entry, it does not pin to the ancestor's scrollport. (In self mode the bar is sticky at the scrollport top, which is what a host-scroll editor must not inherit: the sticky anchor resolves against the ancestor's scrollport once the root stops scrolling, floating the bar over unrelated page content.)

## Edge cases

- `rects.scrollTo` on a block far below the fold resolves `true` and the block ends up inside the ANCESTOR scrollport (the ancestor scrolled, not the root).
- `rects.scrollTo` on a path that addresses no block resolves `false`.
- `rects.scrollTo` past the edge of a host that clips rather than scrolls resolves `false`, while a block above that edge still resolves `true`. The case is the CLIP boundary, not distance: a block just past a short pane's bottom edge is still inside the window viewport, so neither the editor root (which spans the full document height in host mode) nor the window viewport can answer it — visibility is measured against whatever scrolls or clips the editor.
- `setSelection` in host mode reports `true` only once the block is inside the ancestor scrollport, and inherits the same clip bound (a restore into a clipped-out block reports `false`). Task 1's contract routes through the same in-view read, so the mode is an axis of that boolean.

## Error cases

- No uncaught page errors surface during load, scroll, edit, or reveal in host mode.
