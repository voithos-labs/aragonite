# Feature: Directive ops, container, leaf, and text levels (note-taking simulation)

A loaded-ops session on the plugins route over the `:::name` primitive. The
directive feature spans three levels (an opaque container, a leaf that cannot merge,
and an atomic inline widget) and two paths at parse time: a registered name resolves
to its plugin's factory node, an unregistered one to the generic lossless kinds.
Neither path is driven anywhere else under a watcher that accumulates state across a
whole session. The session drives real edits across all three levels while the note
simulation's reference checks (the structured-error and `[invariant:…]` console
watcher, the live-CST round-trip, the nested `BlockListState` audit) run again after
every move, with a fixed seed so runs repeat.

The loaded document opens both parse paths at once: `:::callout` (claimed by the
harness callout plugin) and `:::mystery` (claimed by nothing, so it must land on the
generic container).

The session runs with a standing decoration source installed (`?seed=sim`), so the
reference checks also watch the decoration system re-run on every edit. That source
is view-only, a mark on one fixture word, so it changes no document text, CST, or
undo state; its only job is to keep the decoration system running under the
corruption checks.

## Happy paths

- the standing decoration source is live: once the first per-edit pass runs (at the
  session's first edit), at least one overlay carrying its mark class paints, so a
  decoration source that silently stopped emitting fails the battery instead of
  leaving it green with no coverage
- typing `:name[label]` in a prose block promotes the span to an atomic text widget
  at render time; the caret stays in the host paragraph so editing continues
- clicking the widget shows its source, an edit is typed into the label, and clicking
  onto another block commits it: the document carries the edit only after the commit,
  never while the temporary revealed DOM is showing
- typing `::name info` at column 0 on an empty line promotes the paragraph to a
  directive leaf mid-typing; the trailing characters land in the leaf, not in the
  paragraph it was promoted from
- editing the leaf's info line grows its raw in place without changing its kind
- editing a body child of either container, the generic one or the plugin's own,
  rebuilds the container's raw from its children and leaves the document a single
  container at the root
- Enter in a container body child splits it into a new body child; the container's
  children grow, the document root does not

## Edge cases

- Backspace at the start of a directive leaf moves focus rather than joining into the
  block above (`not-mergeable`): the source must be byte-identical afterwards, checked
  by re-reading it once the key reports whether it was handled, not by waiting for a change
- a container cannot be inserted by typing: a multi-line `:::name … :::` fence never
  forms from typing inside a single block, because the parser leaves an unterminated
  fence as a paragraph. One is inserted by copying an existing container and pasting it
- every edit lands mid-document, never the end-of-document append the expectation
  tracker predicts, so each gesture that triggers a promotion, a widget swap, or a
  reparse waits for a signal it can observe and re-reads the state it actually got
- undo across the paste, across the reveal then commit, and across the body edit each
  restore the prior source

## User interactions

- widget and leaf inserts are per-character keyboard typing, waiting for the mounted
  widget or leaf rather than for a substring (a directive renders its source verbatim
  but dimmed, so the text is present the instant it is typed and only the node count
  says the widget mounted)
- the reveal is a real click on the rendered widget; the caret then steps into the
  label with arrow keys, types, and commits by clicking away
- body and info edits click into the target block and type; the container insert is a
  real click-drag selection, copy, reposition, and paste
- undo uses the real cross-platform shortcut, around a forced batch boundary

## Error cases

- no console, page, or structured editor error fires across the session, including
  the `[invariant:…]` channel the opaque-container checks warn on
- the live serializer round-trips the current CST at every checkpoint
- the nested-state audit finds no `BlockListState` out of sync after any insert,
  reveal, edit, promotion, split, paste, or undo
