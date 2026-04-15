# Block: List — Rendering & Arrow Navigation

Covers how ordered and unordered lists render and how arrow keys traverse and exit them.

## Rendering

- Unordered lists display with `-`, `*`, or `+` markers
- Ordered lists display with `1.`, `2.`, etc. markers
- Nested lists render indented within the parent item
- The entire list (including nested levels) is a single top-level block
- Source round-trips after any edit

## Arrow key navigation

- ArrowDown from last line of last item exits the list to the next block
- ArrowUp from first line of first item exits the list to the previous block
- ArrowDown/ArrowUp between items traverses through all items including nested ones
- ArrowLeft at start of item content moves to end of previous item
- ArrowRight at end of item content moves to start of next item
