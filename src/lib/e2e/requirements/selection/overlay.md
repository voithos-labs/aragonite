# Feature: Selection overlay rendering

## Happy paths

- Cross-block selection renders middle-block overlay on every block between start and end
- Single-block selection uses native rendering, no custom overlay divs
- When selection collapses, all overlay divs are removed

## Edge cases

- Overlay has pointer-events: none so clicks pass through
- Endpoint overlays appear on start and end blocks during cross-block selection
- Container blocks (blockquote, list) do not render their own overlay — their children handle it; no double-layering

## Error / degenerate cases

- Block content changes while cross-block selection exists: overlay should reflect new layout via reactivity
