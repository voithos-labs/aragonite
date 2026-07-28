# Feature: GitHub-alert ops — native alert container (note-taking simulation)

A loaded-ops session on the plugins route over the admonitions plugin's native GitHub
alerts. A `> [!TYPE]` blockquote is its own `githubAlert` strip container in the
blockquote mold: the marker line lives only in the container raw + metadata, the body is
real child blocks, and the bytes are never rewritten to `:::`. The session drives real
edits across the container's lifecycle while the oracle stack — structured error +
`[invariant:…]` console watcher, live-CST round-trip, nested BlockListState audit, and
live-vs-reparse convergence — re-checks after every move, with a fixed seed for
determinism.

The admonitions plugin installs under `?seed=admonitions`, so the session navigates
there and loadContents its own document (a seeded two-child alert plus prose targets).
The alert marker interrupts the paragraph above, so a from-scratch formation leaves no
single-newline lazy-merge divergence — convergence runs unconditionally.

## Happy paths

- typing `> [!TYPE]` on a fresh line promotes the block to an empty `githubAlert` with
  the caret in its body, so typing the body straight on (no second Enter, which exits the
  quote) lands a `githubAlert` root child whose body carries the typed text, bytes
  reading `> [!TYPE]\n> …`
- editing inside the alert body rebuilds the container's raw through the `> [!TYPE]`
  marker (preserved verbatim) and keeps the `githubAlert` kind

## Edge cases

- Alt+Arrow on a body block permutes it among its siblings WITHIN the alert (the strip
  container reorder-within capability, the seam the quote-unwrap climb didn't reach); the
  alert keeps its `githubAlert` kind, its `> [!TYPE]` marker, its root slot, and its child
  count, asserted by the gesture, so a regression to the whole-alert teleport (root count
  changes) or a rebuild-as-blockquote (marker drops) fails loudly
- Backspace at the start of a non-first body block merges it into the previous body block
  (the container `default-merge`); the alert stays one `githubAlert` root with its marker
  intact and its root slot held — the merge never escapes the container, asserted by the
  gesture, so a regression in the middle-child unwrapRole cannot record a corrupted tree
  as truth
- Backspace at the very start of the first body block lifts the first child out and drops
  the marker (the container `lift-first-child`): exactly one `githubAlert` vanishes, its
  body reparses as a plain block, and the bytes are never rewritten to `:::`
- every promotion/merge/unwrap lands mid-document, never the end-of-document append the
  expectation tracker predicts, so each gesture settles on an observable structural signal
  and resyncs from observed state

## User interactions

- the alert is formed after a real Enter opens a fresh line, then the `> [!TYPE]` marker
  arrives as ONE input event and the body is typed per keystroke. The marker is not typed
  key by key, which is what a user does: per-keystroke formation leaves the block a
  `blockquote` that never reclassifies and drives `parseConverged()` false, so the
  keystroke stream is blocked on that defect rather than covered here
- the inner edit clicks the body child, jumps to its end, and types
- the merge and unwrap are real Home + Backspace at the targeted body-block start
- undo uses the real cross-platform shortcut around a forced batch boundary; undoing the
  single-keystroke unwrap restores the seeded alert whole

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel the opaque-container guards warn on
- the live serializer round-trips the current CST at every oracle checkpoint, and a
  reparse of that serialization converges back to the live tree at every checkpoint
- the nested-state audit finds no BlockListState desync after any formation, edit, merge,
  unwrap, or undo
- a middle-child merge that escaped the container to the root, or an unwrap that rewrote
  bytes to `:::`, fails the gesture loudly
