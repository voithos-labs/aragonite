# Feature: Keyboard Navigation, Arrow Traversal

Focus traversal across block boundaries via arrow keys, including the geometry checks (visual line
position rather than logical caret position) that decide when the boundary is reached.

## Happy paths

- ArrowDown at end of block moves to next: typing after ArrowDown affects the next block
- ArrowUp at start of block moves to previous: typing after ArrowUp affects the previous block
- ArrowUp on the first visual line moves to the previous block when that block is a heading, whose
  marker span is a non-text first child: the geometry check, not a text-node read, finds the edge

## Edge cases

- ArrowDown at end of last block: does not crash, creates new empty paragraph
- ArrowUp at start of first block: does nothing
- ArrowDown into container block: focus enters first child of the container
- ArrowUp out of container block: focus exits to the block before the container
- ArrowDown on empty block moves to next block: empty blocks are a single visual line, so geometry check triggers and focus advances
- Leaving a code body backward lands outside a hidden closer, in live mode: Backspace at the start
  of a code block's body moves the caret to the end of the bold paragraph above, and a typed `x`
  goes after its closing `**`. It runs at the top level and inside a quote, since the two used to
  take different traversals and only the top-level one picked the side

## User interactions

- navigate down through multiple blocks: ArrowDown repeatedly, type in final block, verify source
- navigate up then type: ArrowUp from second block, type at end of first block, verify

## Miss-analysis

- Both ArrowDown cases pinned the caret to column 0 of the block it reached, which only the
  harness's own caret placement ever produced: it anchors the caret past the block's last child,
  where the browser reports no box, so the column read as the block's left edge. A real click
  plus End has always crossed the boundary at the column the caret was on, and no case here ran
  the same assertion after a real gesture.
- The quote case typed inside the closer: every hidden-closer case ran at the top level, and the
  arrow keys that dominate them set the side themselves, so a quote's move that picked no side
  never showed.
- The checks run for the caret-geometry change never included the keyboard-navigation project,
  so the two cases went red on the change that made the harness's caret measure like everyone
  else's.
