# Feature: Code Block Navigation Exit

Leaving a fenced code block via Enter-on-empty-line, vertical arrow keys, or Backspace-at-start.

## Edge cases

- exit code block via Enter on empty trailing line: press Enter on an empty last line — exits to a new paragraph after the code block
- ArrowUp in first line exits to previous block: cursor in first line, ArrowUp moves focus above the code block
- ArrowDown in last line exits to next block: cursor in last line, ArrowDown moves focus below
- Backspace at position 0 moves focus to previous block: does not delete the code block
