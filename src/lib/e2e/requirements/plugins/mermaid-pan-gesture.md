# Feature: A widget's own drag is not the editor's

A rendered diagram pans under a held drag. That drag is the widget's gesture, so the editor's
pointer arms must leave it alone: no whole-block range is seeded, no selection overlay is
painted, and focus stays on the block the user is working in. The claim is declared on the
element (`data-pointer-gesture`), not inferred from the kind — a plugin's own
`stopPropagation` fires after the editor's root listeners and cannot reach this.

Fixture (loaded per test): a paragraph `Above text`, one ` ```mermaid ` fence, a paragraph
`tail text`; the broken-fence document for the error-card case.

## Happy paths

- Click the diagram to focus it, then drag inside it: the canvas transform moves by the drag's
  delta, the editor reports no cross-block selection, no selection overlay is mounted, and the
  active element is still inside the block
- The same drag inside the focus-view overlay's viewport pans it and paints no range

## Edge cases

- A drag on the BROKEN diagram's error card, which declares no gesture surface, still takes the
  block whole — the door is the declared element, not the kind
- A drag that STARTS in prose and ends on the diagram is unaffected (the door reads the press
  target only); that contract is pinned in `mermaid-pointer-selection-bytes.md`

## Miss-analysis

- 2026-09 (#328): every mermaid pointer spec drove a click, or a drag that started OUTSIDE the
  diagram, so no test ever held a drag whose press landed on the rendered face. The generalized
  gap: a widget gesture and an editor gesture sharing one press had no test that asserted both
  outcomes at once. The pan was pinned on its transform, the range arm on its bytes, neither on
  the other's silence.
