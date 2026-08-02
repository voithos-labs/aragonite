# Feature: Directive ops — container, leaf, and text tiers (note-taking simulation)

A loaded-ops session on the plugins route over the `:::name` primitive. The
directive surface spans three tiers — opaque container, not-mergeable leaf, atomic
inline widget — and two dispatch paths at parse: a registered name resolves to its
plugin's factory node, an unregistered one to the generic lossless kinds. Neither
path had ever run under a state-accumulating watcher. The session drives real edits
across all three tiers while the note simulation's oracle stack — structured error +
`[invariant:…]` console watcher, live-CST round-trip, nested BlockListState audit —
re-checks after every move, with a fixed seed for determinism.

The loaded document opens both dispatch paths at once: `:::callout` (claimed by the
harness callout plugin) and `:::mystery` (claimed by nothing, so it must land on the
generic container).

The session runs with a standing decoration source installed (`?seed=sim`), so the
oracle stack also watches the decoration engine re-run on every edit. The source is
view-only — a mark on a fixture word — so it changes no source, CST, or undo state;
its only job is to keep the engine live under the corruption net.

## Happy paths

- the standing decoration source is live: once the engine's first per-edit pass runs
  (the first edit of the session), at least one overlay carrying its mark class
  paints, so a source that silently stopped emitting fails the battery instead of
  leaving it green with zero coverage
- typing `:name[label]` in a prose block promotes the span to an atomic text widget
  at render time; the caret stays in the host paragraph so editing continues
- clicking the widget reveals its source, an interior edit typed into the label, and
  blurring onto another block commits it — the source carries the edit only after the
  commit, never while the ephemeral reveal DOM is showing
- typing `::name info` at column 0 on an empty line promotes the paragraph to a
  directive leaf mid-typing; the trailing characters land in the leaf, not the
  paragraph it was
- editing the leaf's info line grows its raw in place without changing its kind
- editing a body child of either container — generic or plugin-factory — rebuilds the
  container's own raw from its children and leaves the document a single container at
  the root
- Enter in a container body child splits it into a new body child; the container's
  children grow, the document root does not

## Edge cases

- Backspace at the start of a directive leaf moves focus rather than concatenating
  into the block above (`not-mergeable`): the source must be byte-identical after it,
  asserted by a positive re-read rather than a delta wait
- a container cannot be inserted by typing — a multi-line `:::name … :::` fence never
  forms from live single-block typing, since the opener declines an unterminated fence
  to a paragraph — so one is inserted by copying an existing container and pasting it
- every edit lands mid-document, never the end-of-document append the expectation
  tracker predicts, so each gesture that triggers a promotion, a widget swap, or a
  reparse settles on an observable signal and resyncs from observed state
- undo across the paste, across the reveal→commit, and across the body edit each
  restore the prior source

## User interactions

- widget and leaf inserts are per-character keyboard typing, gated on the mounted
  widget / leaf rather than on a substring (a directive renders its source
  verbatim-but-dimmed, so the source is present the instant it is typed — only the
  node count marks the mount)
- the reveal is a real click on the rendered widget; the caret then steps into the
  label with arrow presses, types, and commits by clicking away
- body and info edits click into the target block and type; the container insert is a
  real click-drag selection, copy, reposition, and paste
- undo uses the real cross-platform shortcut, around a forced batch boundary

## Error cases

- no console, page, or structured editor error fires across the session, including
  the `[invariant:…]` channel the opaque-container guards warn on
- the live serializer round-trips the current CST at every oracle checkpoint
- the nested-state audit finds no BlockListState desync after any insert, reveal,
  edit, promotion, split, paste, or undo
