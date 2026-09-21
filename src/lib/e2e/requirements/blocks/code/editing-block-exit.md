# Feature: Code Block Navigation Exit

Leaving a fenced code block via Enter-on-empty-line, a typed closer there, vertical arrow keys,
or Backspace-at-start.

## Edge cases

- exit code block via Enter on empty trailing line: press Enter on an empty last line, which exits to a new paragraph after the code block
- exit code block by typing the closer on the empty trailing line: three backticks typed there are the exit, not body text, so the run is never written, the fence keeps its own length, and the caret lands in a new paragraph after the block
- ArrowUp in first line exits to previous block: cursor in first line, ArrowUp moves focus above the code block
- ArrowDown in last line exits to next block: cursor in last line, ArrowDown moves focus below
- Backspace at position 0 moves focus to previous block: it does not delete the code block, and the marker typed afterward lands at the end of the previous block, proving focus moved without corrupting the fence
- Backspace immediately after opener fence edits nothing: caret at the start of the body's first column (just past the opener's `\n`), where Backspace must not delete that newline, which would fuse the body into the opener line. The fence is the document's first block, so leaving it puts the caret in the gap above (requirements/selection/gap-caret-arrival.md)
- Backspace inside info string trims the info string: the opposite case, confirming the check fires only at the two `\n` boundaries and nowhere inside the opener line
- Backspace at position 0 of indented code moves focus without deleting: a neighboring kind that cannot merge behaves the same way, moving focus only
- Backspace at position 0 of html block moves focus without deleting: a neighboring kind that cannot merge behaves the same way, moving focus only

## Miss-analysis

- Exiting a code block was only ever asked of Enter, so the other thing a writer does at the end
  of one, typing the closer, reached the byte-writing path instead, where a body line that reads
  as the closer can only mean "grow the fence".
