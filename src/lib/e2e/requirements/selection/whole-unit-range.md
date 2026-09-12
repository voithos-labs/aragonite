# Feature: A whole-unit range takes every destructive gesture

A drag inside a block that hosts no character position (a rule, a rendered equation) selects
that block whole: one cross-block range whose two endpoints are the same block. Focus parks on
the editor root, where no editing surface exists, so the root is the only door left for the
keystroke. Every destructive gesture must reach the range through it — typing, paste and cut,
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
- One undo restores the document after each gesture — the delete and the insert are one entry.

## Edge cases

- The table's coverage shape (two `Mod+A` presses from inside a cell) reaches the same paste
  arm; `blocks/table/clipboard-in.spec.ts` owns it and must stay green beside these.
- The range is gone after the gesture: no stale overlay stays painted over the landed caret.
