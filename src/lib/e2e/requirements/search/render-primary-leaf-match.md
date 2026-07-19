# Feature: Search inside a folded render-primary leaf widget

A render-primary leaf (block math `$$…$$`, the `[[toc]]` outline) renders its source through a
component, so a match inside its raw has no measurable DOM text node. Search paints it anyway:
while folded, `createEditableLeaf`'s `measurePartialRects` covers the rendered block box — the
opaque single-unit precedent the mermaid container shim set, lifted to the leaf choke point.
Every render-primary leaf, present and future, inherits the highlight with no per-kind code.
Lives in the search area but drives the plugins harness, since only plugin kinds ship
render-primary leaves.

## Happy paths

- A token that exists only inside a folded math block's `$$…$$` source is found (count reads
  1 / 1) and paints a sized `.match-overlay` cover rect inside that block's host.
- A token that exists only inside a folded `[[toc]]` leaf's source is found and paints a sized
  `.match-overlay` inside the toc host — the same factory fallback, a second kind, zero extra
  production code.

## Miss-analysis

- The gap shipped because the leaf tier was built without the opaque-rect fallback the mermaid
  container shim already carried: `measurePartialRects` returned `[]` whenever the source was
  folded, so a match was counted but never painted. The 0.9.24 conformance sweep pinned the
  degraded behaviour rather than real paint, and no focused spec queried text living only in a
  folded leaf's raw. This file pins the folded-leaf query directly, per kind.
