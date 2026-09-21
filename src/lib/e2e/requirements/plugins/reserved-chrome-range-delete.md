# Feature: Reserved-child-0 Chrome rangeDelete Wall

The `:::callout` callout reserves child index 0 as an editable `callout-title` leaf, the
container's own title row. These checks prove that a range delete stops at it. They read
behavior: the tree and the selection read by path through `window.__test`, not visuals.

## Gate 4: rangeDelete chrome wall (must pass)

Nothing merges across the title's boundary. An endpoint outside it is truncated where it is, a
title the range covers is emptied rather than deleted as a node, and the container itself is
removed only when the range covers its whole subtree from outside.

- the whole title covered: Delete over a selection running from the paragraph above through the whole title empties the title leaf, and the body is never lifted into the opener line; undo restores the bytes exactly
- the same gesture from the keyboard: the Delete-into-title gesture, whose sticky column lands at title offset 0, truncates the paragraph above and leaves the title intact
- part of the title covered: the title keeps the tail the range missed, in its own leaf, never merged into the paragraph above
- the title in the middle: a selection from above the callout into a body child truncates the start where it is, empties the title, and keeps the tail of the body child it ends in, leaving later body children untouched
- starting in the title and ending outside: the title keeps its head, every body child is deleted, the container survives with only its title, and the block the range ends in keeps its tail where it is
- the whole subtree covered, both ways: a range strictly around the container, and a range ending exactly at its last byte, each delete the container as one unit, and no invariant fires on the detached node
- the whole callout covered from inside: a range from the start of the title through the end of the body, covering the whole subtree without crossing the boundary from outside, empties the title and truncates the body to an empty paragraph, because the reserved child holds the title, not a bare paragraph
- the rule is no wider than it needs to be: a range inside the callout that touches only the body stays on the shared path, so typing over it merges the two body paragraphs exactly as the same gesture does in a blockquote

## User interactions

- a pointer drag, Shift+End and Shift+ArrowDown, Delete, typing over a selection and Ctrl+Z are real gestures; the assertions read the tree and the selection by path, never the shape of the DOM
