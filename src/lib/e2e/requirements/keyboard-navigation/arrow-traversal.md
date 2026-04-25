# Feature: Keyboard Navigation — Arrow Traversal

Focus traversal across block boundaries via arrow keys.

## Happy paths

- ArrowDown at end of block moves to next: typing after ArrowDown affects the next block
- ArrowUp at start of block moves to previous: typing after ArrowUp affects the previous block

## Edge cases

- ArrowDown at end of last block: does not crash, creates new empty paragraph
- ArrowUp at start of first block: does nothing
- ArrowDown into container block: focus enters first child of the container
- ArrowUp out of container block: focus exits to the block before the container
- ArrowDown on empty block moves to next block: empty blocks are a single visual line, so geometry check triggers and focus advances

## User interactions

- navigate down through multiple blocks: ArrowDown repeatedly, type in final block, verify source
- navigate up then type: ArrowUp from second block, type at end of first block, verify
