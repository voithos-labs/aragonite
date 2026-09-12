# Block: List — Task Checkbox (rendering)

Visual styling for completed vs pending tasks, GitHub's: a done item dims, it is not struck
through; nested sub-lists render independently.

## Happy paths

- Completed tasks render dimmed (a muted text colour) with no strikethrough; unchecked tasks
  render as the plain text around them.

## Regression guards

- Nested task sub-lists render independently — a checked outer item does not dim its nested
  task sub-list's text.
