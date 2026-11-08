# Feature: blocks a plugin draws with `draw`

A `^^field` box (`edit: 'box'`, `routes/test/plugins/drawn`) draws a two-line field of its own and
takes the caret through `Drawn.focus`, handing it back with `ctx.leave`. The seed puts a paragraph
above it and one below.

## Happy paths

- ArrowDown from the line above: the caret enters the field's first line at the column it had.
- ArrowUp from the line below: the caret enters the field's last line at the column it had.
- ArrowUp on the field's first line: the caret leaves into the line above at the field caret's column.
- ArrowDown on the field's last line: the caret leaves into the line below at the field caret's column.

## Edge cases

- ArrowRight at the end of the line above enters the field at its start; ArrowLeft there leaves back to that line's end.
- ArrowLeft at the start of the line below enters the field at its end; ArrowRight there leaves back to that line's start.
- The caret at an offset inside the field, Alt+ArrowDown moves the box down a block and Ctrl+Z puts it back, with the caret at that same offset in the field.

## A fence drawn as a preview (`edit: 'source'`)

A ` ```shown ` fenced block (`fencedBlock`, same harness) draws a preview of its body until the caret comes in.

- Clicking the preview shows the fence's text in its place and hides the preview.
- Typing in the shown text and clicking away writes it, and one Ctrl+Z takes all of it back.
