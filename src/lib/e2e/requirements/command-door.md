# Feature: runCommand, the one entry point for semantic commands

`editor.runCommand(id)` runs a command at the focused block with no chord in the
path. It is what a host's selection toolbar calls, so the button keeps working
when a consumer rebinds the chord, and it must land exactly what the chord lands:
the same handler, one undo entry, the selection still usable afterwards.

The selection is built with real gestures in every scenario. The call itself
is programmatic on purpose: `runCommand` is a programmatic API, and the toolbar button
is its only user.

## Happy paths

- a word selected by keyboard extend, then the strong toggle through `runCommand`: the
  source gains `**` around exactly that word, and one undo restores it
- the same word through the emphasis, strikethrough and inline-code ids: each writes
  its own delimiter pair and nothing else moves
- the call's bytes match the chord's byte for byte: toggle through `runCommand`, undo,
  then press the chord over the same re-selected range
- the selection survives the toggle, so a second call on the same range strips
  the pair it just wrote

## Edge cases

- a consumer `keybindings` override that moves the strong toggle off `Mod+B` leaves
  `runCommand` unchanged: the id still runs, and the rebound chord still runs, so the
  toolbar button is not rewired by a host's keymap
- the link-edit id opens the link card over a selection, the same card `Mod+K` opens
- a caret with no selection, in a mode that paints the delimiters: the toggle writes
  an empty pair at the caret, matching the chord's collapsed-caret behavior
- the same caret in `'live'`, which paints no delimiter and so may write no empty
  pair: the call reports it handled the key (`true`), no bytes move, and the mark waits
  until the next typed character carries it (`live-mode.md` § 4.3)
- a table cell holds the caret: the call reaches the cell's own handler through the
  component reference the cell publishes
- a gap caret holds the selection: no block is focused, so every block-local id
  declines and nothing mutates, and the gap caret survives the call

## Error cases

- a cross-block range painted with real gestures, then the strong toggle through
  `runCommand`: it routes to the cross-block handler, marks each endpoint's own span (the
  anchor block's tail, the focus block's head) and one undo restores the whole range. This
  is the `runCommand` half of #127: the chord path is taken at the cross-block keydown
  handler, which a `runCommand` call never reaches, so this is where that route is proven
- the link editor over that same range is the one range command still declined: it
  writes over one block's offsets and a range gives it none, so the call returns
  `false` and the source is byte-identical
- an unknown id declines and mutates nothing
- reading mode declines every published id, source byte-identical
- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture)

## Miss-analysis

- The cross-block format refusal was written at the keydown handler that swallows the
  default chords, so nothing tested it as a rule about commands. A second way to
  dispatch (this call) would have walked straight into the single-block handlers, and the
  suite had no case that reached a format handler by id rather than by keystroke (#127).
- Its two selection-shaped edges, a collapsed caret and a gap caret, were either
  scenarios without tests or handlers without scenarios: the third selection mode is
  reachable by gesture but never was one, and the collapsed caret was written as one
  outcome where the mode decides between two.
