# Feature: LaTeX math fence, GitHub's fenced `math` form

A fenced code block whose info string starts with exactly `math` parses as its own `mathFence`
kind, neither `mathBlock` nor a plain `fencedCode`, and renders through the same render-primary
BlockMath component as `$$…$$`. How the shared editable leaf behaves (showing its source, the
caret, selection, paste) is proven by `latex-block.spec.ts`. This file pins only what is
specific to the fence: which kind it is, and that showing its source, editing it and committing
keeps the kind and round-trips. On `/test/plugins?seed=mathfence` the fence sits at block 1
between two paragraphs.

## Happy paths

- the fenced `math` block renders exactly one KaTeX display through the shared
  `.math-block-render` element, with no source shown while it is rendered
- the block is the `mathFence` kind, its bytes hold the verbatim `math` fence, and it is never
  rewritten to `$$` nor left as a plain `fencedCode`

- the fenced `math` block stands off the blocks above and below it by the same padding as a
  `$$` block, since both are the same component
  (miss-analysis: the padding was keyed on the `$$` kind's name, and every layout check seeded
  only a `$$` block)

## User interactions

- ArrowRight from the paragraph above shows the source with the caret at its leading edge;
  walking to the `x^2` body, typing a character and blurring onto the paragraph below commits
  the edit, re-renders KaTeX, keeps the kind `mathFence`, and the document round-trips stable

## Edge cases

- the edit lands in the math body, not in the info string: editing the info string would move
  its first token off `math` and reparse the block to `fencedCode`, so editing the body is the
  path that keeps the kind, and that is what the test exercises
