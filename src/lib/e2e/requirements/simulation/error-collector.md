# Feature: Simulation error collector (oracle wiring)

The note-taking simulation's `ErrorCollector` is the designated proxy-bug oracle.
It must observe every channel the editor uses to surface a contained failure —
otherwise a session can run green while a violation it should have caught is
silently dropped (the original §12 gap: a detector wired to a channel it doesn't
read). These tests prove the collector actually trips, by injecting faults and
asserting `assertNone` throws.

## Happy paths

- clean session: after `start()` and a normal `loadContent`, `assertNone` does
  not throw

## Error cases

- structured `error` event is caught: a block forced to throw on render
  (`makeBlockThrowOnRender`) emits `error{origin:"render"}`, and `assertNone`
  throws naming the origin
- subscription survives a source resync: the structured-error subscription is
  established (`start()`) before a `loadContent`, yet the render-error injected
  after the resync is still caught — proving the editor's events instance is
  stable across a source-prop change
- invariant violation is caught: a `[invariant:…]`-marked dev warning is
  recorded and `assertNone` throws (the commit/bootstrap invariant seam routes
  through this marker)
- ref-slot proxy warnings are caught: a `state_proxy_equality_mismatch` or
  `[state-registry]` warning trips `assertNone` — the raw-vs-proxy ref-slot
  class reds the gate the day it returns
- benign warnings are ignored: a plain `console.warn` without the marker does
  not trip the collector (so real sessions stay green on expected dev warnings)
