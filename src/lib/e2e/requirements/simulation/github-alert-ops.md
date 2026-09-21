# Feature: GitHub-alert ops, native alert container (note-taking simulation)

A loaded-ops session on the plugins route over the admonitions plugin's native GitHub
alerts. A `> [!TYPE]` blockquote is its own `githubAlert` strip container in the
blockquote mold: the marker line lives only in the container raw and metadata, the body
is real child blocks, and the bytes are never rewritten to `:::`. The session drives
real edits across the container's lifecycle while the reference checks (the
structured-error and `[invariant:…]` console watcher, the live-CST round-trip, the
nested `BlockListState` audit, and the comparison of the live tree against a reparse of
its serialization) run again after every move, with a fixed seed so runs repeat.

The admonitions plugin installs under `?seed=admonitions`, so the session navigates
there and loads its own document with `loadContents` (a seeded two-child alert plus
prose targets). The alert marker interrupts the paragraph above, so an alert built from
scratch leaves no single-newline lazy-merge divergence and the reparse comparison runs
at every checkpoint.

## Happy paths

- typing `> [!TYPE]` on a fresh line one key at a time promotes the block to a blockquote
  at `>` and reclassifies it to an empty `githubAlert` when the marker closes, leaving the
  caret in its body, so typing the body straight on (no second Enter, which exits the
  quote) lands a `githubAlert` root child whose body carries the typed text, bytes
  reading `> [!TYPE]\n> …`
- editing inside the alert body rebuilds the container's raw through the `> [!TYPE]`
  marker (preserved verbatim) and keeps the `githubAlert` kind

## Edge cases

- Alt+Arrow on a body block moves it among its siblings inside the alert (the strip
  container's reorder-within capability, which the quote-unwrap climb never reached); the
  alert keeps its `githubAlert` kind, its `> [!TYPE]` marker, its position at the root,
  and its child count, all asserted by the gesture, so a regression that moved the whole
  alert instead (the root count changes) or rebuilt it as a blockquote (the marker drops)
  fails loudly
- Backspace at the start of a non-first body block merges it into the previous body block
  (the container `default-merge`); the alert stays one `githubAlert` root with its marker
  intact and its position at the root unchanged, so the merge never escapes the
  container. The gesture asserts this, so a regression in the middle child's `unwrapRole`
  cannot record a corrupted tree as truth
- Backspace at the very start of the first body block lifts the first child out and drops
  the marker (the container `lift-first-child-drop-opener`): exactly one `githubAlert` vanishes, its
  body reparses as a plain block, and the bytes are never rewritten to `:::`
- every promotion, merge or unwrap lands mid-document, never the end-of-document append
  the expectation tracker predicts, so each gesture waits for a structural signal it can
  observe and re-reads the state it actually got

## User interactions

- the alert is formed after a real Enter opens a fresh line, then the `> [!TYPE]` marker
  and the body are typed per keystroke, so the blockquote promotion at `>`, the inline
  recognizer's handler for `[`, and the container reclassification at `]` each arrive as
  their own input event, the way a user produces them
- the inner edit clicks the body child, jumps to its end, and types
- the merge and unwrap are real Home + Backspace at the targeted body-block start
- undo uses the real cross-platform shortcut around a forced batch boundary; undoing the
  single-keystroke unwrap restores the seeded alert whole

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel the opaque-container checks warn on
- the live serializer round-trips the current CST at every checkpoint, and a reparse of
  that serialization matches the live tree at every checkpoint
- the nested-state audit finds no `BlockListState` out of sync after any formation, edit,
  merge, unwrap, or undo
- a middle-child merge that escaped the container to the root, or an unwrap that rewrote
  bytes to `:::`, fails the gesture loudly
