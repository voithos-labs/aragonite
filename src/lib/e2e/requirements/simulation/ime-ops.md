# Feature: IME-ops (note-taking simulation)

A loaded-ops session that drives real IME composition under the simulation's oracle
stack. The handler-level and CDP e2e harnesses pin the composition contract in
isolation; the note-taking simulation typed ASCII only until this session. A CDP
composition surface is threaded through the SimContext (created once per session,
never a global), and the gesture vocabulary composes → updates → commits a
multibyte candidate at the caret while the oracle stack — structured error +
invariant-console watcher, live-CST round-trip, nested-state audit, parse
convergence — re-checks after every move.

Determinism comes from a single seeded PRNG selecting the composition from a fixed
table; one test per seed spreads the candidates across runs. Mid-composition there
is no source change to settle on — the compose window is DOM-only — so a compose
settles on the composed text arriving in the focused element's DOM, and the commit
settles on the committed bytes reaching the source.

## Happy paths

- composing a multibyte candidate through progressive updates keeps the source
  byte-stable across every update; the source changes only when the composition
  commits
- the committed bytes land in the block once, and the live serializer round-trips
- an aborted composition (the window ended with no insert) commits nothing: the
  source is byte-identical before and after
- a single undo after a composed commit restores the pre-composition text in one step
  (one undo entry — the commit funnels through one content update)
- a committed multibyte insert in one paragraph survives while an undone commit in
  another is gone

## Edge cases

- the compose window writes to the focused element's DOM, not the source, so a
  mid-composition source delta is a corruption signal the session fails on
- the seed selects the composition content from a fixed table, so a failure replays
  byte-for-byte at that seed

## User interactions

- the composition is driven through a real CDP surface: `Input.imeSetComposition` per
  update fires genuine compositionstart/update events; `Input.insertText` commits
  through a real compositionend; an empty insert aborts
- the target block is focused with a real end-of-block caret placement before the
  composition begins
- undo uses the real cross-platform shortcut

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel (G1.27's composition-pairing guard among them)
- the live CST round-trips and converges with a reparse of its serialization at every
  checkpoint
- the nested-state audit finds no BlockListState desync after any commit, abort, or undo
