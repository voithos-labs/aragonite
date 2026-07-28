# Feature: selected image-widget copy/cut

A selected inline image widget copies its own source slice on Mod+C and cuts it on
Mod+X. Focus sits in the prose contenteditable (a collapsed caret) while the widget is
selected, so Ctrl+C/Ctrl+X fire real copy/cut events that reach the block's clipboard
handlers. The branch is policy-agnostic — the `<br>` widget is covered by unit tests.

## Happy paths

- Widget selected, Mod+C: clipboard holds the image markdown (`![cat](url)`); the
  document is unchanged and the widget stays selected (overlay still visible).
- Widget selected, Mod+X: the raw loses exactly the widget slice, the clipboard holds
  it, the selection clears, and one Mod+Z restores the document.

## Edge cases

- Cut is a single undoable commit — one Mod+Z restores the pre-cut source exactly.
- Copy never mutates: the selection survives it.

## User interactions

- Select the widget with the ArrowLeft boundary gesture (caret stays in the
  contenteditable so the copy event reaches onCopy) — not a click, which can move focus
  to the overlay portal.
