# Feature: Wide-table horizontal scroll + scroll-aware overlay/drag

## Happy paths

- A 12-column table renders with a horizontal scrollbar on `.table-block` (total content width exceeds container width)
- Each column respects a min-width floor so cells stay readable; columns do not collapse to single-character ribbons
- Cross-block selection painted across multiple table cells stays visually aligned with the cells after the user scrolls the table horizontally
- Drag-select beginning inside a wide table reaches off-screen cells via inner-scroll autoscroll when the pointer approaches the table's right or left edge
- ArrowUp from a paragraph below a wide table re-enters the column closest to the pre-exit pixel-X (sticky-X), measured against editor-relative coords

## Edge cases

- Small (3-column) tables continue to look natural — no trailing empty space, no scrollbar
- Selection overlay cleanup: scrolling the table after collapsing the selection does not leave stale overlays
- Drag-autoscroll stops when the pointer leaves the threshold band

## Regression notes

- Generalizes the same machinery to any internally-scrollable block (code blocks already use `overflow-x: auto`)
- Sticky-X coord-space fix: `collectColumnRects` now returns editor-relative rects, matching the captured X
