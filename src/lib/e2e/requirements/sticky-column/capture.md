# Feature: Sticky column — capture and survive intermediate clamping

Cross-block caret column memory for vertical arrow navigation. The first vertical arrow after a reset captures the cursor's editor-relative pixel X; subsequent arrows reuse that X to land the caret at the nearest offset in each target block.

## Happy paths

- ArrowDown from a long paragraph into another long paragraph lands the caret at the same pixel X (within tolerance)
- ArrowUp from a long paragraph into another long paragraph lands the caret at the same pixel X

## Edge cases

- ArrowDown through a short intermediate block clamps there but preserves the original column when the next block is long again
- ArrowDown through multiple short intermediate blocks still lands the caret at the original column in the final long block
