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
- invariant violation is caught: a `[aragonite:invariant:…]`-marked dev warning
  is recorded and `assertNone` throws (the commit/bootstrap invariant seam
  routes through this marker)
- every dev warning is caught, not just invariant fires: a plain
  `[aragonite:…]` warning trips `assertNone`, so a diagnostic the editor emits
  mid-session cannot ride out a green run
- Svelte runtime warnings are caught by their code, not by a list of known ones:
  a warning headed `[svelte] state_proxy_equality_mismatch`, emitted in Svelte's
  own `%c` shape, trips `assertNone`, and the waiver that silences it
  (`svelte:state_proxy_equality_mismatch`) reads the same at the spec watch and
  at the checkpoint
- warnings from outside the editor are ignored: a `console.warn` with no
  `[aragonite:…]` head does not trip the collector, so a host page's own
  diagnostics stay out of the verdict
- the checkpoint waiver is per-tag: `assertNone(['tag'])` silences that tag's
  fires and nothing else: an unwaived fire in the same session still throws,
  and the report names it alone
