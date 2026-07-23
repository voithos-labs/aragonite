# Feature: LaTeX math fence — GitHub's ```math form

A fenced code block whose info string's first token is exactly `math` parses as the
distinct `mathFence` kind, not `mathBlock` and not a plain `fencedCode`, and renders
through the same render-primary BlockMath component as `$$…$$`. The shared editable-leaf
mechanics (reveal/caret/selection/paste) are proven by `latex-block.spec.ts`; this pins
only what is specific to the fence — its kind identity and that its interactive
reveal→edit→commit path keeps the kind and round-trips. On
`/test/plugins?seed=mathfence` the fence sits at block 1 between two paragraphs.

## Happy paths

- the ```math fence renders exactly one KaTeX display through the shared
  `.math-block-render` surface, with no source exposed while folded
- the block is the `mathFence` kind, its bytes contain the verbatim ```math fence, and
  it is never rewritten to `$$` nor left as a plain `fencedCode`

## User interactions

- reveal from the paragraph above via ArrowRight lands the caret at the source leading
  edge; walking to the `x^2` body and typing a char, then blurring onto the paragraph
  below, commits the edit, re-renders KaTeX, keeps the kind `mathFence`, and the document
  round-trips stable

## Edge cases

- the edit lands in the math BODY, not the info string: an info-string edit would flip
  the info's first token off `math` and reparse to `fencedCode`, so the body edit is the
  kind-stable path the test exercises
