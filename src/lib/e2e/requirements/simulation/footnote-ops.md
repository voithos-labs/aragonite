# Feature: Footnote ops, definition container + reference widget (note-taking simulation)

A loaded-ops session on the plugins route over the first-party footnotes plugin. The plugin
spans two levels the corruption checks had never watched across a whole session: the
`[^label]: ` strip-container definition (a container in the same mold as `listItem`, which
nothing outside it can merge into) and the `[^label]` inline reference widget (the inline
syntax handler for the `[^` prefix, which reveals its source for editing).
The session drives real edits at both levels while the reference checks (the
structured-error and `[invariant:…]` console watcher, the live-CST round-trip, the nested
`BlockListState` audit, and the comparison of the live tree against a reparse of its
serialization) run again after every move, with a fixed seed so runs repeat.

The footnotes plugin is seed-gated, so the session navigates to `?seed=footnotes` (which
installs it) and loads its own document with `loadContents` over the seed's. A reference's
number is display state derived from the document, which the expectation tracker never
models; `footnotes-reference.spec.ts` is the test that checks the live renumbering, so this
session asserts the structure is intact rather than the numbers.

## Happy paths

- typing `[^label]` in a prose block mounts an atomic reference widget once the closing `]`
  lands; the literal bytes stay in the block's raw, so the source holds the reference the
  instant it is typed and only the widget count says it mounted
- moving the caret into a collapsed reference shows its raw source, and clicking away
  collapses it again: a view-only toggle that moves no byte across the round trip
- revealing a reference, inserting into its label, and committing with Enter rewrites the
  source only after the commit, never while the temporary revealed DOM is showing
- entering `[^label]: body` over a whole prose paragraph forms a footnote-def strip container
  with one paragraph child on the reparse. It is typed per character, which takes the line
  through a temporary inline reference widget: the `[^label]` prefix mounts one on its
  closing `]`, and the `: ` plus body are typed against that widget's trailing edge before
  the reparse resolves the line to a definition marker
- Enter in the middle of a definition body child splits it into two body children; the
  container's children grow, the document root does not (the strip container uses
  blockquote's split override). The reparse still matches the live tree at every
  checkpoint, the split included
- editing the split continuation child rebuilds the container's own raw around it and leaves
  the document a single footnote-def at that root index

## Edge cases

- a destructive key next to a collapsed reference shows its source rather than deleting it
  whole; a second press removes the opening `[`, and committing turns the reference into
  literal text, which one undo reverses
- Backspace at the start of a definition's first body child lifts that child out of the
  container (`lift-first-child-keep-container`): it becomes the paragraph before the marker
  and the rest of the body stays under it, never joining into the block above. The gesture
  asserts the lifted shape by re-reading the tree, and one undo restores the bytes exactly.
  Miss-analysis: the gesture pinned the earlier not-mergeable no-op and only the controller
  runs this project, so the contract change passed review and went red only when it landed
- every edit lands mid-document, never the end-of-document append the expectation tracker
  predicts, so each gesture that triggers a promotion, a widget swap, or a reparse waits for
  a signal it can observe and re-reads the state it actually got
- undo across the exit lift, the continuation edit, the body split, and the definition
  promotion each restore the prior source without corrupting the tree

## User interactions

- reference inserts are per-character keyboard typing, waiting for the mounted widget; the
  definition marker is entered as one event (see the marker-formation note above), waiting
  for the mounted container rather than for a substring
- the reveal is a real caret entry (an arrow key into the widget's leading edge); the
  collapse is a real click onto another block; the label edit steps into the label with
  arrow keys, types, and commits with Enter
- the body split clicks into the body child, jumps to its end, and presses Enter; the body
  edit clicks the target child and types; the exit is a real Home + Backspace at the body
  start
- undo uses the real cross-platform shortcut, around a forced batch boundary

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel the opaque-container checks warn on
- the live serializer round-trips the current CST at every checkpoint, and a reparse of
  that serialization matches the live tree at every checkpoint except those where an
  Enter-split has left two paragraphs joined by a single newline (the documented
  `splitNode` divergence, a platform defect rather than a footnote one). The comparison is
  waived at those checkpoints, exactly as the simulation's note fixtures waive it, and
  restored once the split is undone
- the nested-state audit finds no `BlockListState` out of sync after any insert, reveal,
  edit, promotion, split, or undo
- a definition body split that escaped the container to the document root fails the gesture
  loudly (it asserts the root count held), so a regression in the shared split override
  cannot record a corrupted tree as truth
