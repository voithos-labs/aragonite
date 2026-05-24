# Feature: Live raw-HTML widget paste-while-selected

A paragraph that contains a live raw-HTML widget (currently only `<br>`, per
LIVE_HTML_TAGS) routes paste-while-selected through the same widget-replacement
path as image widgets. Both widget kinds must replace their source-byte range
with the pasted text — not insert at offset 0 with the widget retained.

## Happy paths

- Paste plain text while a `<br>` widget is selected replaces the widget bytes
  with the pasted text at the widget's source range.

## Edge cases

- Undo after the replace restores the original `<br>` and lands the caret at
  the pre-select offset (the offset the caret occupied just before widget
  selection took over).
