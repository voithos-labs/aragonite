# Feature: A whole-unit range takes every destructive gesture

A drag inside a block that holds no character position (a rule, a rendered equation) selects
that block whole: one cross-block range whose two endpoints are the same block. Focus rests on
the editor root, where no editable area exists, so the root is the only way in left for the
keystroke. Every destructive gesture must reach the range through it: typing, paste and cut,
not only Backspace.

## Happy paths

- Drag inside a rule between two paragraphs, type `x`: the rule is gone, a paragraph holding
  `x` stands in its place, and both neighbours keep their own bytes and kinds.
- Drag inside a rule, paste `pasted`: the rule is replaced by the clipboard's block, neighbours
  untouched.
- Drag inside a rule, cut: the clipboard holds `---`, the rule leaves the document.
- Drag inside a rendered equation, cut: the clipboard holds the `$$…$$` bytes and the block goes.

## User interactions

- The caret after a typed character sits after it: a second character lands beside the first
  rather than at the block's head.
- One undo restores the document after each gesture: the delete and the insert are one entry.
- The undo after a typed character puts the rule back held whole, not only its bytes: a second
  character typed straight after the undo replaces the rule again.
  - Miss-analysis: the undo scenario read the bytes back and stopped, so a restore that put no
    selection back at all passed it.

- Backspace over the rule puts the caret at the end of the block above (the side Backspace
  points), so a typed `x` joins `above`.
- With nothing above and a list below, the caret goes to the start of the list's first item: a
  typed `x` lands inside it, not in the list's wrapper where it would go nowhere.
  - Miss-analysis: the delete tests here only read the bytes, and the unit suite for this delete
    only had paragraph neighbours, so a caret aimed at a list's wrapper never showed up.

## Edge cases

- The table's version of this (two `Mod+A` presses from inside a cell) reaches the same paste
  branch; `blocks/table/clipboard-in.spec.ts` owns it and must stay green beside these.
- The range is gone after the gesture: no stale overlay stays painted over the landed caret.
