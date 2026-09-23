# Feature: Image widget selection

## Happy paths

- Click on widget enters widget-selected state (overlay portal with popover and resize handles renders at the widget's bounds)
- Click on text outside widget exits selected state

## User interactions

- ArrowLeft from caret at right boundary enters selected state
- ArrowLeft while selected: caret moves to left boundary, widget deselects
- ArrowRight from caret at left boundary enters selected state
- ArrowRight while selected: caret moves to right boundary, widget deselects
- ArrowLeft from left boundary exits the paragraph (or moves into preceding text)
- Escape deselects the widget
- End while selected: the widget deselects and the caret moves to the end of the line, as Home,
  PageUp and PageDown move it from the widget's edge
  - Miss-analysis: only the arrow keys were asserted on a selected image; the remaining keys were
    swallowed, and no spec pressed one
- Moving the mouse off a selected image, or pressing its resize handle or its crop frame, leaves
  no document caret: the paragraph keeps focus while its image is selected, and the browser puts
  a caret at its start on any mouse input, which the editor drops while the image stays selected
  - Miss-analysis: no spec read the native selection after a press on the image's controls, and
    the one that pressed the image three times read only the selected text

## Edge cases

- Selecting a different widget replaces the previous selection
- Cross-block selection clears widget selection
- Undo of an edit made before the image was selected moves the image's bytes: the image
  deselects and a live caret goes back where the undone typing began, so an arrow moves it and
  the next character lands beside it
  - Miss-analysis: no spec edited the document under a selected image, so nothing noticed the
    selection kept pointing at bytes the image had left
- Redo after that undo: no image is selected and the caret the redo puts back stays live
