# Feature: Fork-A Spike — Reserved-child-0 Chrome rangeDelete Wall

The `:::callout` callout reserves child index 0 as an editable `callout-title` chrome
leaf. This gate proves the rangeDelete chrome wall. Behavioral gate: CST/selection
read by path via `window.__test`, not visuals.

## Gate 4 — rangeDelete chrome wall (must pass)

Nothing merges across the note's wall: outside endpoints truncate in place,
covered chrome clears (never node-deletes), and the container dies only when
the range consumes its whole subtree from outside.

- full title coverage: Delete over a selection from the paragraph above through the whole title clears the chrome to an EMPTY callout-title — the body never hoists into the opener line; undo restores byte-for-byte
- gesture parity: the historical Delete-into-title keyboard gesture (whose sticky column lands at title offset 0) truncates the paragraph above and leaves the chrome intact
- partial title coverage: the title keeps its uncovered tail in the chrome leaf, never merged into the paragraph above
- chrome-between: a selection from above the callout into a body child truncates the start in place, clears the chrome, and keeps the end body child's tail in place (later body children untouched)
- start-in-chrome, end outside: the title keeps its head, all body children delete, the container survives title-only, and the outside end block keeps its tail in place
- whole-subtree coverage (both variants): a range strictly around the container, and a range ending exactly at its last byte, both delete the container as one unit — no invariant fires on the detached node
- inside-only whole-callout coverage: a range from the title start through the body end (covering the whole subtree WITHOUT crossing the wall from outside) clears the title and truncates the body to an empty paragraph — the reserved slot holds chrome, not a bare paragraph
- gate tightness: a body-only range inside the callout stays on the generic path — type-over merges the two body paragraphs exactly like the same gesture in a blockquote

## User interactions

- pointer drag, Shift+End/Shift+ArrowDown, Delete, type-over, Ctrl+Z are real gestures; assertions read the CST/selection by path, never the DOM shape
