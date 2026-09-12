# Feature: Sticky column — code block entry symmetry

Entering a code block via ArrowDown from the block above and via ArrowUp from the block below, given matched sticky X in each direction, must land the caret at the same pixel X and the same body offset. Isolates regressions in `findOffsetNearestX` / `CodeBlock.focusAtColumn`.

## Happy paths

- Single-line body: ArrowDown-from-above and ArrowUp-from-below with matched sticky X land at the same pixel X
- Multi-line body (identical first/last body-line widths): landing X is symmetric regardless of interior content
- Info-string opener (` ```javascript `, wider opener line than closer): body-offset landing remains symmetric given matched sticky X
- highlight.js token spans fragmenting the body line: landing remains symmetric across span boundaries

## Edge cases

- Landing body offset (not just pixel X) matches both directions: a typed marker lands at the same byte position in the serialized body regardless of entry direction
- DEFAULT_CONTENT js code block from the `/test/editor` harness: matched sticky X from above and below produces symmetric landing X. The two neighbours have different end columns, so their clicks quantize to different character boundaries; the bound is one measured character cell widened by exactly that gap, and it is asserted on every run whatever the gap measures

## Miss analysis

The landing comparison sat under `if (captureDelta < 5)`, so whether it ran at all was decided by the fixture's text, the host's font metrics and the viewport rather than by the editor. No gate catches an assertion that stops running: G4.23 pairs a requirement with its spec, it does not ask whether a scenario's assertion is reachable. The generalized answer: a spec never guards an assertion on measured data, the bound absorbs the measurement instead.

The DEFAULT_CONTENT scenario clicked the block above the fence at its top edge, which in that fixture is the first item of a three-item list, so its ArrowDown landed in the second item and the "above" leg measured a list column against a code column. The two agreed by pixel coincidence until the code box's padding changed. A landing scenario asserts which block the caret landed in before it measures where.
