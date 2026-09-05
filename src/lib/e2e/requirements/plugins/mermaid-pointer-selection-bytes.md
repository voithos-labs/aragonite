# Feature: pointer-drag cross-block bytes over a whole-block kind

A pointer drag that ends inside a rendered mermaid diagram has no character position to land on:
the block renders an SVG and a toolbar, not the block's markdown. The endpoint must therefore
address the unit whole, so copy and cut move the diagram's bytes intact rather than a slice of the
rendered text's length.

## Happy paths

- Drag from mid-paragraph into the middle of the rendered diagram, then Mod+C: the clipboard holds
  the paragraph tail, the blank line, and the diagram's complete fenced markdown.
- The same drag followed by Mod+X: the remaining document is the paragraph head joined to the
  block after the diagram, with no fence remnant left behind.

## Edge cases

- The drag settles on a rendered diagram (the SVG is mounted before the pointer moves), so the
  endpoint is minted over real diagram content rather than a loading placeholder.

## Miss-analysis

- A cross-block copy/cut driven by real pointer drag onto a whole-block kind, asserting clipboard
  bytes, should have caught this; the only spec landing such an endpoint drove by keyboard (the
  safe mint) and asserted overlay rects (offset-insensitive); the conformance kit derived its
  expectation from the rule under test; G1.29 was table-only.
