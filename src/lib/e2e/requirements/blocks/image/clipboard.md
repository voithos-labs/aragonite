# Feature: selected image-widget copy/cut

A selected inline image widget copies its own source slice on Mod+C, cuts it on Mod+X, and is
replaced by the payload on Mod+V. The branch is policy-agnostic — the `<br>` widget is covered
by unit tests.

Selecting a widget clears the native selection, so whether the chord's event reaches the block
depends on whether the paragraph holds a text position for a caret to survive in. Beside prose
one does. In a widget-only paragraph none does, and the browser dispatches copy/cut/paste at
`<body>`, where the editor root claims it and forwards to the block owning the selected widget.
Both selection routes (cross-block edge entry, click) reach the same state, so both are pinned.

## Happy paths

- Widget selected, Mod+C: clipboard holds the image markdown (`![cat](url)`); the document is
  unchanged and the widget stays selected (overlay still visible).
- Widget selected, Mod+X: the raw loses exactly the widget slice, the clipboard holds it, the
  selection clears, and one Mod+Z restores the document.
- Widget selected, Mod+V: the widget's slice is replaced by the pasted text.

## Edge cases

- Cut is a single undoable commit — one Mod+Z restores the pre-cut source exactly.
- Copy never mutates: the selection survives it.
- Every case preloads a sentinel onto the clipboard, because the clipboard outlives the browser
  context and a chord that writes nothing would otherwise read back the previous case's payload.

## User interactions

- Select the widget by clicking it.
- Select the widget by stepping into it from the block above (ArrowRight at that block's end),
  which routes through the cross-block edge-entry landing. A caret seated programmatically
  INSIDE a widget-only block never enters the widget at all, so it is not a substitute gesture.

## Miss-analysis

- The suite pinned this branch on `lead![cat](url)`, a paragraph with prose beside the image, so
  a caret always survived the selection and the event always reached the block. Nothing exercised
  a widget-only paragraph, which is the shape that has no text position at all — the same
  "endpoint hosts no caret" hole the editor-root clipboard seam already existed for, one
  selection state further out. The old requirement compounded it by recording the click route as
  a gesture constraint ("not a click, which can move focus to the overlay portal") instead of
  pinning it red.
