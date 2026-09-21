# Feature: Selection overlay rendering

## Happy paths

- Cross-block selection renders middle-block overlay on every block between start and end
- Single-block selection uses native rendering, no custom overlay divs
- When selection collapses, all overlay divs are removed

## Edge cases

- Overlay has pointer-events: none so clicks pass through
- Endpoint overlays appear on start and end blocks during cross-block selection
- A container the range holds whole (blockquote, list) paints one box over everything it renders, its own markers included; its children paint none, so nothing is drawn twice

## Error / degenerate cases

- Block content changes while cross-block selection exists: overlay should reflect new layout via reactivity
