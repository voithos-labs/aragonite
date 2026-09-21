# Feature: pointer-drag cross-block bytes over a whole-block kind

A pointer drag that ends inside a rendered mermaid diagram has no character position to land on,
because the block renders an SVG and a toolbar rather than its own markdown. The endpoint
therefore has to address the whole block, so copy and cut move the diagram's bytes intact rather
than a slice the length of the rendered text.

## Happy paths

- Drag from mid-paragraph into the middle of the rendered diagram, then Mod+C: the clipboard
  holds the tail of the paragraph, the blank line, and the diagram's complete fenced markdown.
- The same drag followed by Mod+X: what is left of the document is the head of the paragraph
  joined to the block after the diagram, with no piece of the fence left behind.

## Edge cases

- The drag ends on a rendered diagram, with the SVG mounted before the pointer moves, so the
  endpoint is placed over real diagram content rather than over a loading placeholder.

## Miss-analysis

- A cross-block copy and cut driven by a real pointer drag onto a whole-block kind, asserting
  the clipboard bytes, should have caught this. The only spec that landed such an endpoint drove
  it by keyboard, which is the safe path, and asserted overlay rects, which say nothing about
  offsets; the conformance kit derived its expectation from the rule under test; and G1.29
  covered tables only.
