# Feature: Undo and redo around a selected image

## Edge cases

- Undo of an edit made before the image was selected moves the image's bytes: the image
  deselects and a live caret goes back where the undone typing began, so an arrow moves it and
  the next character lands beside it
  - Miss-analysis: no spec edited the document under a selected image, so nothing noticed the
    selection kept pointing at bytes the image had left
- Redo after that undo: no image is selected, and the redone caret sits live at the image's end,
  where the click that selected it put the caret
- Redo pressed while an image is selected, then undo: the caret comes back live at the image's end
- The toolbar's remove button, a click in another paragraph, then undo: the image comes back and
  the caret sits live at its end, where the click that selected it put the caret
- An alt edit that a click in another paragraph commits, then undo: the caret comes back live at
  the image's end
- A resize from the image's handle, a click in another paragraph, then undo: the caret comes back
  live at the resized image's end, not at the paragraph start
  - Miss-analysis: the redo case pinned the paragraph start as the recorded caret, and no spec
    undid a resize, so the entry's caret was never read after a gesture on a selected image
- Typing in the paragraph below an image, clicking the image, then undo: the image's bytes don't
  move, and it still deselects, the caret goes back live where the typing began, and the next
  character lands there
  - Miss-analysis: the only undo spec here moved the image's bytes, and the image's own check for
    moved bytes deselected it before the caret came back, so nothing covered an undo that leaves
    the image where it was
