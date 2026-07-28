# Feature: Footnote ops — definition container + reference widget (note-taking simulation)

A loaded-ops session on the plugins route over the first-party footnotes plugin. The plugin
spans two tiers the corruption oracle stack had never watched under a state-accumulating
watcher: the `[^label]: ` strip-container definition (a not-mergeable container in the listItem
mold) and the `[^label]` inline reference widget (the `[^`-prefix ladder rung, reveal-to-edit).
The session drives real edits across both tiers while the oracle stack — structured error +
`[invariant:…]` console watcher, live-CST round-trip, nested BlockListState audit, and
live-vs-reparse convergence — re-checks after every move, with a fixed seed for determinism.

The footnotes plugin is seed-gated, so the session navigates `?seed=footnotes` (which installs
it) and loadContents its own document over the seed's. The reference NUMBER is derived display
state the expectation tracker never models; the reference e2e (`footnotes-reference.spec.ts`) is
the oracle for the live renumber, so this session asserts structural integrity, not numbers.

## Happy paths

- typing `[^label]` in a prose block mounts an atomic reference widget once the closing `]`
  lands; the literal bytes stay in the block's raw, so the source carries the reference the
  instant it is typed and only the widget count marks the mount
- caret-entering a folded reference reveals its raw source and blurring away folds it back — a
  pure view toggle that moves no byte across the round trip
- revealing a reference, inserting into its label, and committing with Enter rewrites the source
  only after the commit, never while the ephemeral reveal DOM is showing
- entering `[^label]: body` over a whole blank-line-separated prose paragraph forms a
  footnote-def strip container with one paragraph child on the reparse. It forms over a
  blank-line-separated paragraph (not one split off by Enter, whose single-newline separator
  would let the `interruptsParagraph: false` definition lazily merge back on reparse — the
  documented Enter-at-end divergence, a general split defect not a footnote one), and it is
  typed per character, which routes the line through a transient inline reference widget: the
  `[^label]` prefix mounts one on its closing `]`, and the `: ` plus body are typed against
  that widget's trailing edge before the reparse resolves the line to a definition marker
- Enter in the middle of a definition body child splits it into two body children; the
  container's children grow, the document root does not (the strip container inherits
  blockquote's split override). The split is mid-child, not at the child's end: an end-split
  mints a trailing empty child that a footnote-def's indent-free blank continuation cannot keep
  attached on reparse (the Enter-at-end class inside the container, `docs/issues.md`), so that
  sub-case is a noted residual rather than a pinned one
- editing the split continuation child rebuilds the container's own raw around it and leaves the
  document a single footnote-def at that root index

## Edge cases

- a destructive key adjacent to a folded reference reveals it rather than deleting it whole; a
  second press then removes the opening `[` and a commit degrades the reference to literal text,
  reversed by one undo
- Backspace at the start of a definition's first body child moves focus upward rather than
  concatenating into the block above or unwrapping the container into loose paragraphs
  (`not-mergeable`): the source is byte-identical after it, asserted by a positive re-read
- every edit lands mid-document, never the end-of-document append the expectation tracker
  predicts, so each gesture that triggers a promotion, a widget swap, or a reparse settles on an
  observable signal and resyncs from observed state
- undo across the continuation edit, the body split, and the definition promotion each restore
  the prior source without corrupting the tree

## User interactions

- reference inserts are per-character keyboard typing gated on the mounted widget; the
  definition marker is entered as one event (see the marker-formation note above), gated on the
  mounted container rather than on a substring
- the reveal is a real caret entry (arrow into the widget's leading edge); the fold is a real
  click onto another block; the label edit steps into the label with arrow presses, types, and
  commits with Enter
- the body split clicks into the body child, jumps to its end, and presses Enter; the body edit
  clicks the target child and types; the exit is a real Home + Backspace at the body start
- undo uses the real cross-platform shortcut, around a forced batch boundary

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel the opaque-container guards warn on
- the live serializer round-trips the current CST at every oracle checkpoint, and a reparse of
  that serialization converges back to the live tree at every checkpoint EXCEPT those where an
  Enter-split has left a single-newline-joined paragraph pair (the documented splitNode
  divergence, a platform defect not a footnote one) — convergence is waived per checkpoint
  there, exactly as the sim's note fixtures waive it, and restored once the split is undone
- the nested-state audit finds no BlockListState desync after any insert, reveal, edit,
  promotion, split, or undo
- a definition body split that escaped the container to the document root fails the gesture
  loudly (it asserts the root count held), so a regression in the shared split override cannot
  record a corrupted tree as truth
