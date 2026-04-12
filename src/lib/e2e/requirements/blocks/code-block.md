# Feature: Code Block Editing

Typing and navigation inside fenced code blocks (textarea-based editing surface).

## Happy paths
- typing inside code block updates source: click into code block, type text, source reflects the change
- Enter creates newline inside code block: Enter inserts a newline, does not split into a new block
- code block content round-trips: editing then checking getSource() produces valid fenced code

## Edge cases
- exit code block via Enter on empty trailing line: press Enter on an empty last line — exits to a new paragraph after the code block
- ArrowUp in first line exits to previous block: cursor in first line, ArrowUp moves focus above the code block
- ArrowDown in last line exits to next block: cursor in last line, ArrowDown moves focus below
- Backspace at position 0 moves focus to previous block: does not delete the code block

## User interactions
- type multi-line code then navigate out: type several lines, ArrowDown past last line, type in the block below
- edit code then undo: type in code block, undo reverts the typed text
