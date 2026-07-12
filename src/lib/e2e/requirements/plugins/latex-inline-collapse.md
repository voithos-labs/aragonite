# Feature: inline math reveal — collapse scoping and switch

Paired spec: `src/lib/e2e/tests/plugins/latex-inline-collapse.spec.ts`, on the
`math-two` seed — two inline equations in one paragraph, the showcase shape that
surfaced the class. Collapse is selection-containment-scoped: the reveal folds
when the caret/selection leaves the revealed source, not only when focus leaves
the block.

## Happy paths

- Reveal eq1 by click, click prose elsewhere in the same paragraph: eq1 re-renders (no `$…$` echo), the CST is untouched, and the caret lands at the click point — a typed char inserts there, not at the widget's trailing edge.
- Reveal eq1, click eq2: ONE sequenced fold→reveal gesture — eq1 re-renders, eq2's source reveals live for typing at its leading edge, and the CST holds both originals.

## Edge cases

- A fresh reveal HOLDS: the click's own queued selectionchange lands after the source swap but before the caret moves into the source, and must not fold the opening reveal — every reveal assertion re-checks after a settle interval, never only the transient (the self-fold race's oracle hole).
- Reveal eq1, click a different block: the blur path still folds and re-renders (regression guard around the containment fold).
- A cross-block selection sweeping through a revealed source keeps it revealed (pinned by `latex-inline.spec.ts`).
- Block math (`$$…$$`) is structurally one-widget-per-block; its blur-scoped fold is unaffected (pinned by `latex-block.spec.ts`).
