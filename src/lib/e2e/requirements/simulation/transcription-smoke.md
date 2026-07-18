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
- jump-back edit nets to identity: after clicking into the first block, a char is
  typed mid-document and backspaced out, returning the source to its pre-detour
  value before the end-state oracle runs
- empty baseline calibration: after clearing, the source is exactly `"\n"`;
  a different value stops the session loudly rather than masking the drift

## User interactions

- typing uses per-character keyboard events (not a programmatic value set)
- jump back to edit an earlier section: a real pointer click repositions into the
  first block, the focus block path must equal the clicked target (a wrong-block
  landing is a hard failure, never recorded as truth), then a cancelling edit is
  made there
- undo / redo use real cross-platform keyboard shortcuts and restore the exact
  pre/post-gesture source around a forced batch boundary
- whole-session undo unwind: after the build, undoing the entire stack to its floor
  reaches the session's initial source (`"\n"`) byte-exact, then redoing to the top
  reconstructs the built note; the stack depth comes from the debug bridge

## Error cases

- no console or page errors fire during the session
- nested BlockListState stays consistent (no container id/ref desync)
- the serialized source is a byte fixed point (`serialize(parse(src)) === src`) AND the live
  CST converges structurally with a reparse of that source, so a gesture that left the tree
  diverging from its own raw is caught where the byte check is blind (checkpoint cadence)
- both selection endpoints resolve to live CST nodes with leaf offsets within raw length,
  so a gesture that stranded a dangling selection endpoint is caught before the next
  keystroke dereferences it
