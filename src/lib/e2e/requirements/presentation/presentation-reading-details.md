# Feature: reading mode: the transient details disclosure

Reading mode never writes bytes. But a user has to be able to open a collapsed
`<details>` to read it, so the disclosure toggle there changes **view state** only:
the body mounts, the source does not move, no undo entry appears, and no `edit` event
fires. Leaving reading mode discards that change, and the document's own `open` is the
only truth again. Task checkboxes stay inert, so the two affordances are deliberately
different: a checkbox click would be a document edit, opening a disclosure is not.

The state in effect (the document's `open`, or the user's change over it) is what the
container's collapse clamp reads, so a section opened this way genuinely mounts and
measures its children rather than showing an open caret over an unmounted body.

Driven on `/test/plugins?seed=details` via the header "Reading mode" toggle and real
clicks on the disclosure; source stability is asserted through the `window.__test`
bridge, and undo-stack length through its undo-stack helper.

## Happy paths

- in reading mode, clicking a collapsed section's disclosure mounts its body children
  and the content becomes visible
- clicking again re-collapses it, unmounting the body children
- a section the document has open closes on the user's first click (the change is
  relative to the document's state, not to a default)

## Edge cases

- the change is view-only: `getSource()` is byte-identical after opening, after closing,
  and after several toggles
- it creates no history: the undo stack length is unchanged across the toggles
- leaving reading mode discards the change: a section the document calls collapsed is
  collapsed again in source mode, with the source still byte-identical
- the collapse clamp sees the state in effect: a section opened this way mounts its
  body hosts (the same thing the document-`open` clamp is asserted against), so the
  view and the mount agree
- a task checkbox in the same mode stays inert (covered by `presentation-reading`):
  this one disclosure is not a general unblocking

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture), and in particular the collapse cross-check must not fire while a user
  holds a section open
