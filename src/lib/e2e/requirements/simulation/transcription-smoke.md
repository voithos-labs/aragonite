# Feature: Transcription smoke (note-taking simulation)

A short, deterministic note-taking session driven entirely through real
keyboard and mouse input from an empty document, guarded by the harness oracle
suite. The skeleton acceptance gate: green, identical across two runs, under the
wall-time budget.

## Happy paths

- types a short note from empty char-by-char: each printable keystroke settles
  the source to the predicted string, so content is verified at every character
- paragraph then bullet list: Enter materializes the next block, the auto-inserted
  list marker is resynced, and the finished source matches the canonical note
- end-state equals canonical: the gesture-built source equals the source the
  editor produces by loading the note's markdown (typing ≡ loading)

## Edge cases

- injected typos self-correct: a wrong neighbor key is typed, settled, then
  backspaced out before the intended char, netting to identity on the source
- empty baseline calibration: after clearing, the source is exactly `"\n"`;
  a different value stops the session loudly rather than masking the drift

## User interactions

- typing uses per-character keyboard events (not a programmatic value set)
- click to reposition uses a real pointer click; the focus block path must equal
  the clicked target (a wrong-block landing is a hard failure, never recorded as
  truth)
- undo / redo use real cross-platform keyboard shortcuts and restore the exact
  pre/post-gesture source around a forced batch boundary

## Error cases

- no console or page errors fire during the session
- nested BlockListState stays consistent (no container id/ref desync)
- the live serializer round-trips the current CST (`serialize(parse(src)) === src`)
