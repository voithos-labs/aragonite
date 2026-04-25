# Block: List — Task Checkbox (rendering)

Visual styling for completed vs pending tasks; nested sub-lists render independently.

## Happy paths

- Completed tasks render with strikethrough and muted color; unchecked tasks render normally.

## Regression guards

- Nested task sub-lists render independently — toggling an outer task item does not strike through its nested task sub-list's text.
