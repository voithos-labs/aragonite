# Feature: inline math: when a shown source closes, and switching between two

Paired spec: `src/lib/e2e/tests/plugins/latex-inline-collapse.spec.ts`, on the `math-two` seed,
two inline equations in one paragraph, the shape from the showcase where this class of bug
showed up. Closing is scoped by what the selection covers: the source closes when the caret or
the selection leaves it, not only when focus leaves the block.

## Happy paths

- Show eq1 by clicking it, then click prose elsewhere in the same paragraph: eq1 re-renders with no `$…$` left on screen, the tree is untouched, and the caret lands at the click point, so a typed character goes in there rather than at the widget's trailing edge.
- Show eq1, then click eq2: one gesture that closes and opens in order. eq1 re-renders, eq2's source opens ready for typing at the point clicked, its tail, inside the closing `$`, and the tree holds both originals.

## Edge cases

- A source just opened stays open: the click's own queued selectionchange arrives after the swap but before the caret moves into the source, and it must not close what is opening. Every assertion that a source is open re-checks after things settle rather than reading only the moment it opens, which is the gap that let a source close itself.
- Show eq1, then click a different block: the blur path still closes it and re-renders, which guards the case that the selection-scoped close broke.
- A cross-block selection sweeping through a shown source leaves it shown (pinned by `latex-inline.spec.ts`).
- Block math (`$$…$$`) has one widget per block by construction, so closing it on blur is unaffected (pinned by `latex-block.spec.ts`).
