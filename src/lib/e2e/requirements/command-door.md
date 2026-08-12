# Feature: runCommand — the semantic command door

`editor.runCommand(id)` runs a command at the focused surface with no chord in the
path. It is what a host's selection toolbar calls, so the button keeps working
when a consumer rebinds the chord, and it must land exactly what the chord lands:
same arm, one undo entry, the selection still usable afterwards.

The selection is built with real gestures in every scenario. The invocation itself
is programmatic on purpose: the door IS a programmatic API, and the toolbar button
is its only user.

## Happy paths

- a word selected by keyboard extend, then the strong toggle through the door: the
  source gains `**` around exactly that word, and one undo restores it
- the same word through the emphasis, strikethrough and inline-code ids: each writes
  its own delimiter pair and nothing else moves
- the door's bytes match the chord's byte for byte over the same selection, pressed
  in a second editor load of the same document
- the selection survives the toggle, so a second door call on the same range strips
  the pair it just wrote

## Edge cases

- a consumer `keybindings` override that moves the strong toggle off `Mod+B` leaves
  the door unchanged: the id still runs, and the rebound chord still runs, so the
  toolbar button is not rewired by a host's keymap
- the link-edit id opens the link card over a selection, the same card `Mod+K` opens
- a caret with no selection: the toggle writes an empty pair at the caret, matching
  the chord's collapsed-caret behavior
- a table cell holds the caret: the door reaches the cell's own arm through the
  published ref slot

## Error cases

- a cross-block range painted with real gestures, then the strong toggle through the
  door: it declines, the source is byte-identical, and no undo entry is pushed. This
  is the door half of #127 — the chord path is consumed at the cross-block keydown
  arm, which a door call never reaches
- an unknown id declines and mutates nothing
- reading mode declines every published id, source byte-identical
- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture)

## Miss-analysis

- The cross-block format decline was written at the keydown arm that swallows the
  default chords, so nothing tested it as a rule about COMMANDS. A second dispatch
  surface (this door) would have walked straight into the single-block arms, and the
  suite had no case that reached a format arm by id rather than by keystroke (#127).
