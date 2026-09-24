# Feature: Reading the selection while an image is selected

## User interactions

- A key pressed while an image is selected whole: a host reading `getSelection()` in its own
  keydown handler gets the image's end, and no `selectionChange` payload names the paragraph's
  start
  - Miss-analysis: only the undo capture read the selected image first, and no spec read the
    public selection between a key and the moment the editor drops the browser's caret
- A resize from the image's handle while it stays selected: `getSelection()` reports the
  resized image's new end, never an offset its old bytes left behind
  - Miss-analysis: the read took the offset stored at selection time, and no spec read the
    selection after a commit rewrote the selected image's own bytes
