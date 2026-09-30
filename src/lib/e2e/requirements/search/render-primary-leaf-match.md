# Feature: Search inside a collapsed render-primary leaf widget

A render-primary leaf (block math `$$…$$`, the `[[toc]]` outline) renders its source through a
component, so a match inside its raw has no measurable DOM text node. Search paints it anyway:
while the source is hidden, `createEditableLeaf`'s `measurePartialRects` covers the rendered block
box, the same single-box treatment the mermaid container shim uses, moved to the one place every
leaf goes through. Every render-primary leaf, present and future, inherits the highlight with no
per-kind code. This file lives in the search area but drives the plugins harness, since only
plugin kinds ship render-primary leaves.

## Happy paths

- A token that exists only inside a math block's hidden `$$…$$` source is found (count reads
  1 / 1) and paints a sized `.match-overlay` cover rect inside that block's host.
- A token that exists only inside a `[[toc]]` leaf's hidden source is found and paints a sized
  `.match-overlay` inside the toc host: the same fallback in the factory, a second kind, no extra
  production code.

## Miss-analysis

- The gap shipped because the leaf level was built without the opaque-rect fallback the mermaid
  container shim already carried: `measurePartialRects` returned `[]` whenever the source was
  hidden, so a match was counted but never painted. The 0.9.24 conformance sweep pinned the
  degraded behavior rather than real paint, and no focused spec queried text living only in the
  hidden source of a leaf. This file pins that query directly, per kind.
