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

The landing comparison above sat under `if (captureDelta < 5)`, so on any run where the two clicks quantized further than 5px apart the scenario asserted nothing past `expect(cellWidth).toBeGreaterThan(0)` — silently, and decided by the fixture's text, the host's font metrics and the viewport rather than by the editor. No gate catches an assertion that stops running: G4.23 checks that a requirement and its spec pair up, not that a scenario's assertion is reachable. The generalized answer: a spec never guards an assertion on measured data — the bound absorbs the measurement instead. Mintable as a source scan over `e2e/tests/` for `expect(` inside an `if` whose condition reads a measured local.
