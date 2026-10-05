# Feature: a live `<br>` selected whole

A live `<br>` tag renders as a non-editable widget, and ArrowRight from its start selects it whole,
the way a click selects an image. It's held the same way an image is, so the same gestures grow a
range from it.

## User interactions

- Shift+click in the text after a selected `<br>`: the range runs from the `<br>`'s start to the
  press, so a typed character replaces the `<br>` and the text up to the press
- Shift+click in the next block with a `<br>` selected: the range runs from the `<br>`'s start
  into that block, and `getSelection()` reads it back that way
  - Miss-analysis: every shift-click spec selected an image, and the editor read a selected
    widget's span through a lookup that only found images, so a selected `<br>` had no span to
    grow from and the press left it selected
