# Feature: IME-ops (note-taking simulation)

A loaded-ops session that drives real IME composition under the simulation's
reference checks. The handler-level and CDP e2e harnesses pin the composition
contract in isolation; this session drives it inside a full note-taking run, which
types ASCII everywhere else. A CDP composition driver is passed through `SimContext`
(created once per session, never a global), and the gesture vocabulary composes,
updates, then commits a multibyte candidate at the caret while the reference checks
(the structured-error and invariant console watcher, the live-CST round-trip, the
nested-state audit, and the reparse comparison) run again after every move.

Runs repeat because a single seeded random generator picks the composition from a
fixed table; one test per seed spreads the candidates across runs. Mid-composition
there is no change in the source to wait for, since the compose window touches only
the DOM, so a compose waits for the composed text to arrive in the focused element's
DOM and the commit waits for the committed bytes to reach the source.

## Happy paths

- composing a multibyte candidate through progressive updates keeps the source
  byte-stable across every update; the source changes only when the composition
  commits
- the committed bytes land in the block once, and the live serializer round-trips
- an aborted composition (the window ended with no insert) commits nothing: the
  source is byte-identical before and after
- a single undo after a composed commit restores the pre-composition text in one step
  (one undo entry: the commit goes through a single content update)
- a committed multibyte insert in one paragraph survives while an undone commit in
  another is gone

## Edge cases

- the compose window writes to the focused element's DOM, not the source, so a
  change in the source mid-composition is a corruption signal the session fails on
- the seed selects the composition content from a fixed table, so a failure replays
  byte-for-byte at that seed

## User interactions

- the composition is driven through real CDP calls: `Input.imeSetComposition` per
  update fires genuine compositionstart/update events; `Input.insertText` commits
  through a real compositionend; an empty insert aborts
- the target block is focused with a real end-of-block caret placement before the
  composition begins
- undo uses the real cross-platform shortcut

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel (the composition-pairing check, G1.27, among them)
- the live CST round-trips and matches a reparse of its serialization at every
  checkpoint
- the nested-state audit finds no `BlockListState` out of sync after any commit, abort,
  or undo
