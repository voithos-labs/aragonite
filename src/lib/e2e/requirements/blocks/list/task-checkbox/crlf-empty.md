# Block: List, Task Checkbox (emptying a CRLF to-do)

A to-do in a CRLF file keeps its own line ending while its text is deleted and typed again: the
marker is the box and the space after it, and the `\r\n` stays with the item's line. A marker that
took the `\r` would leave a lone carriage return behind the next keystroke, which a reload reads
as a line ending of its own.

Miss-analysis: the task-marker tests typed into LF paragraphs, and the shape property skipped
list-item bodies, so no test emptied a CRLF to-do, where the marker's whitespace match took the
`\r` and the paragraph kept a bare `\n`.

## Happy paths

- `- [x] foo` over CRLF, `foo` deleted with three Backspaces from its end, reads `- [x] ` over
  CRLF and reloads to the same shape; typing `x` then writes `- [x] x` over CRLF.

## Edge cases

- in `para`, a blank line, `- [x] foo` and `- [ ] bar`, all CRLF, the same gestures leave every
  other line CRLF and the item reads `- [x] x` over CRLF.

## User interactions

- a click on `foo`, End, three Backspaces, then a typed `x`.
