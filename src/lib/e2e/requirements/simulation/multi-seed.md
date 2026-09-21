# Feature: Note-Taking Simulation, Multi-Seed Fuzz

Fuzzes the typo / detour / undo interleavings of a full authoring session by
running one representative note (meeting minutes) through `runSession` across many
seeds. The seed fully determines every random draw, so each seed is a distinct,
replayable interleaving. Runs ungated in the default simulation project:
`capture:false` (checks only, no screenshots) keeps it fast, and only the capture
suites stay behind `SIM_CAPTURE`. One test per seed, so failures isolate and runs go
in parallel.

## Happy paths

- per-seed session completes: each seed builds the note and every reference check
  holds (no errors, nested-state consistency, round-trip stability, in-order
  landmarks, undo/redo differential)
- end-state equality per seed: every seed reaches the same canonical end state
  (typing ≡ loading) regardless of which typos and detours the seed fired

## Edge cases

- seed-varied typo stream: a seed that injects more cancelling typos still nets to
  the same source (each typo types a wrong neighbor key then backspaces it out)
- seed-gated cancelling detours: the pauses, select-delete-undo, copy-paste-undo,
  reorder, cross-block-destroy, and merge detours fire on different seeds; whichever
  combination fires, the pre-detour source is restored byte-exact before the session
  continues
- seed-gated cross-block destruction: a real cross-block range (Shift+Arrow /
  Shift+Click / double select-all) is destroyed (Backspace / Delete / Cut / type-over /
  paste-over), the structural sweep of checks holds on the collapsed tree, and the
  trailing undo restores the source byte-exact
- seed-gated block merge: Backspace at the second block's start merges into (or exits)
  the first, the structural sweep holds, and the trailing undo restores byte-exact
- seed-gated range interrupt: a live cross-block range is interrupted by one gesture
  (dead-space click, a press on the drag handle, Escape, find-bar round trip, image
  click; the set is read off the live document, so a note without an image never draws
  that one), then a single printable key must land on the outcome that gesture is
  pinned to. The trailing undo restores byte-exact. Contracts and predictions live in
  `range-interrupt-ops.md`; here the seed varies which gesture meets which mid-session
  tree
- isolation under parallelism: independent pages and random generators per seed
  produce the same asserted source whether run serially or concurrently

## History

- whole-session undo unwind (one seed): after the build, undoing the entire stack to
  the bottom reaches the session's initial source byte-exact, and redoing to the top
  reconstructs the built note
- selection validity after structural gestures: both selection endpoints resolve to
  live nodes with leaf offsets within raw length, checked at each checkpoint and after
  every cross-block / merge destruction

## Determinism

- replay stability: running a given seed twice asserts the identical end state. What
  is asserted is the source, which does not depend on timing (pauses vary wall-time
  but not the resulting source)
