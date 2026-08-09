# Feature: byte stability across mode flips through live

Live is a peer of the other four rungs, so the flip family's contract now covers
it: whatever mode the document was in and whatever gesture ran there, flipping
through live and out again must leave the source byte-identical. Marker hiding
is CSS over the one render path, so a flip commits nothing — the only bytes that
may differ are those an EDIT wrote, and those must survive every later flip
unchanged. Driven on `/test/editor` through the header toggles (real clicks),
with the `window.__test` source bridge as the oracle. The simulation drives the
same contract per seed (`requirements/simulation/…`), where the mode is one draw
of a seeded detour; this file pins the deterministic rungs.

## Happy paths

- flipping source → live → source leaves the source byte-identical
- flipping through every rung in turn (reading, preview-block, preview-inline,
  live) and back to source leaves the source byte-identical
- an edit typed IN live survives a flip out to each other rung and back, byte
  for byte

## Edge cases

- a document whose blocks are all marker-bearing (heading, fence, table, list,
  reference link) is the fixture, so a flip that dropped or duplicated a marker
  span shows up as a byte difference rather than a paint difference
- the flip is pinned on BYTES only: the caret does not survive a mode change on
  any rung (issue #109), so nothing here may be read as "a flip is fully safe" —
  the pending-mark row below is the closest the caret contract gets, and it pins
  that no bytes are stranded rather than that the caret is kept

## User interactions

- the mode is entered and left by clicking the header toggle, never by setting
  the prop — the toggle is the consumer-facing path and the one a flip mid-edit
  actually takes
- the edit that must survive is typed with real keystrokes

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
