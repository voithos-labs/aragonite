# Feature: reading mode — the transient details disclosure

Reading mode never writes bytes. But a reader has to be able to open a collapsed
`<details>` to read it, so the disclosure toggle there flips **view state**: the body
mounts, the source does not move, no undo entry appears, and no `edit` event fires.
Leaving reading mode discards the flip — the document's own `open` is the only truth
again. Task checkboxes stay inert, so the two affordances are deliberately different:
a checkbox click WOULD be a document edit, a disclosure flip is not.

The effective state (document `open`, or the reader's flip over it) is what the
container's collapse clamp reads, so a transiently-opened section genuinely mounts and
measures its children rather than showing an open caret over an unmounted body.

Driven on `/test/plugins?seed=details` via the header "Reading mode" toggle and real
clicks on the disclosure; source stability is asserted through the `window.__test`
bridge, and undo-stack length through its undo-stack probe.

## Happy paths

- in reading mode, clicking a collapsed section's disclosure mounts its body children
  and the content becomes visible
- clicking again re-collapses it, unmounting the body children
- an open-in-the-document section closes on the reader's first click (the flip is
  relative to the document's state, not to a default)

## Edge cases

- the flip is view-only: `getSource()` is byte-identical after opening, after closing,
  and after several toggles
- the flip creates no history: the undo stack length is unchanged across the toggles
- leaving reading mode discards the flip — a section the document calls collapsed is
  collapsed again in source mode, with the source still byte-identical
- the collapse clamp sees the EFFECTIVE state: a transiently-opened section mounts its
  body hosts (the same observable the document-`open` clamp is asserted against), so
  the view and the mount agree
- a task checkbox in the same mode stays inert (covered by `presentation-reading`) —
  the transient disclosure is not a general ungating

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture) — in particular the collapse-probe cross-check must not fire while a
  reader holds a section open
