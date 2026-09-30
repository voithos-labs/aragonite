# Feature: selected image-widget copy/cut

A selected inline image widget copies its own source slice on Mod+C, cuts it on Mod+X, and is
replaced by the payload on Mod+V. The branch does not care which widget it is: the `<br>` widget
is covered by unit tests.

Selecting a widget clears the browser's selection, so whether the chord's event reaches the block
depends on whether the paragraph has a text position for a caret to survive in. Beside prose
it does. In a widget-only paragraph it does not, and the browser fires copy/cut/paste at
`<body>`, where the editor root takes it and forwards it to the block owning the selected widget.
Both selection routes (cross-block edge entry, click) reach the same state, so both are pinned.

## Happy paths

- Widget selected, Mod+C: clipboard holds the image markdown (`![cat](url)`); the document is
  unchanged and the widget stays selected (overlay still visible).
- Widget selected, Mod+X: the raw loses exactly the widget slice, the clipboard holds it, the
  selection clears, and one Mod+Z restores the document.
- Widget selected, Mod+V: the widget's slice is replaced by the pasted text.

## Edge cases

- Cut is a single undoable commit: one Mod+Z restores the source exactly as it was.
- Copy never changes anything: the selection survives it.
- Every case preloads a sentinel onto the clipboard, because the clipboard outlives the browser
  context and a chord that writes nothing would otherwise read back the previous case's payload.

## User interactions

- Select the widget by clicking it.
- Select the widget by stepping into it from the block above (ArrowRight at that block's end),
  which goes through the cross-block edge-entry landing. A caret placed programmatically
  inside a widget-only block never enters the widget at all, so it is no substitute for the
  gesture.

## Miss-analysis

- The suite pinned this branch on `lead![cat](url)`, a paragraph with prose beside the image, so
  a caret always survived the selection and the event always reached the block. Nothing exercised
  a widget-only paragraph, which is the shape with no text position at all: the same
  "no caret at the endpoint" hole the editor root's own clipboard handling was written for, one
  selection state further out. The old requirement made it worse by recording the click route as
  a limit on the gesture ("not a click, which can move focus to the overlay portal") instead of
  pinning it red.
