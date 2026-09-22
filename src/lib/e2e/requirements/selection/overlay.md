# Feature: Selection overlay rendering

## Happy paths

- Cross-block selection renders middle-block overlay on every block between start and end
- Single-block selection uses native rendering, no custom overlay divs
- When selection collapses, all overlay divs are removed

## Edge cases

- Overlay has pointer-events: none so clicks pass through
- Endpoint overlays appear on start and end blocks during cross-block selection
- A container the range holds whole (blockquote, list) paints one box over everything it renders, its own markers included; its children paint none, so nothing is drawn twice
- A list item the range holds whole paints its own box over its marker and its content, though it renders no block host of its own; a nested sub-list under such an item paints no second box
  - Miss-analysis: every overlay test ran over blocks a block host wraps, so an item, the one container that renders none, was the case no test could reach

## Error / degenerate cases

- Block content changes while cross-block selection exists: overlay should reflect new layout via reactivity
