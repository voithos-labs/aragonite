# Feature: Note-Taking Simulation — Multi-Seed Fuzz

Fuzzes the typo / detour / undo interleavings of a full authoring session by
running one representative note (meeting minutes) through `runSession` across many
seeds. The seed fully determines every random draw, so each seed is a distinct,
replayable interleaving. Gated behind `SIM_CAPTURE`; `capture:false` (oracles only,
no screenshots) keeps it fast. One test per seed so failures isolate and runs
parallelize.

## Happy paths

- per-seed session completes: each seed builds the note and the full oracle suite
  holds (no-errors, nested-state consistency, round-trip stability, in-order
  landmarks, undo/redo differential)
- end-state equality per seed: every seed reaches the same canonical end state
  (typing ≡ loading) regardless of which typos and detours the seed fired

## Edge cases

- seed-varied typo stream: a seed that injects more cancelling typos still nets to
  the same source (each typo types a wrong neighbor key then backspaces it out)
- seed-gated cancelling detours: the pauses, select-delete-undo, and copy-paste-undo
  detours fire on different seeds; whichever combination fires, the pre-detour source
  is restored byte-exact before the session continues
- isolation under parallelism: independent pages and rng instances per seed produce
  the same asserted source whether run serially or concurrently

## Determinism

- replay stability: running a given seed twice asserts the identical end state — the
  asserted artifact is the source, which is timing-independent (pauses vary wall-time
  but not the resulting source)
