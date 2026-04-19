# Feature: Sticky column — code block entry symmetry

Entering a code block via ArrowDown from the block above and via ArrowUp from the block below, given matched sticky X in each direction, must land the caret at the same pixel X and the same body offset. Isolates regressions in `findOffsetNearestX` / `CodeBlock.focusAtColumn`.

## Happy paths

- Single-line body: ArrowDown-from-above and ArrowUp-from-below with matched sticky X land at the same pixel X
- Multi-line body (identical first/last body-line widths): landing X is symmetric regardless of interior content
- Info-string opener (` ```javascript `, wider opener line than closer): body-offset landing remains symmetric given matched sticky X
- highlight.js token spans fragmenting the body line: landing remains symmetric across span boundaries

## Edge cases

- Landing body offset (not just pixel X) matches both directions: a typed marker lands at the same byte position in the serialized body regardless of entry direction
- DEFAULT_CONTENT js code block from the `/test/editor` harness: matched sticky X from above and below produces symmetric landing X
