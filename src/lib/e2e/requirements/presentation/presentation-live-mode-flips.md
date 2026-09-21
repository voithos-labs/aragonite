# Feature: byte stability across mode flips through live

Live is a peer of the other four presentation modes, so the contract the other
mode switches already carry now covers it: whatever mode the document was in and
whatever gesture ran there, switching through live and out again must leave the
source byte-identical. Marker hiding is CSS over the one render path, so a mode
switch commits nothing. The only bytes that may differ are those an edit wrote,
and those must survive every later switch unchanged. Driven on `/test/editor`
through the header toggles (real clicks), with the `window.__test` source bridge
as the answer each scenario checks against. The simulation drives the same
contract per seed (`requirements/simulation/…`), where the mode is one draw of a
seeded detour; this file pins the deterministic modes.

## Happy paths

- switching source → live → source leaves the source byte-identical
- switching through every mode in turn (reading, preview-block, preview-inline,
  live) and back to source leaves the source byte-identical
- an edit typed in live survives a switch out to each other mode and back, byte
  for byte

## Edge cases

- a document whose blocks are all marker-bearing (heading, fence, table, list,
  reference link) is the fixture, so a switch that dropped or duplicated a marker
  span shows up as a byte difference rather than a paint difference
- this file pins bytes only: the caret's survival across the same switches is its
  own contract, `presentation-mode-flip-caret.md` beside this file

## User interactions

- the mode is entered and left by clicking the header toggle, never by setting
  the prop: the toggle is the consumer-facing path and the one a mid-edit switch
  actually takes
- the edit that must survive is typed with real keystrokes

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
