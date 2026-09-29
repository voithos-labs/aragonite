# Feature: Keyboard Navigation, a Keyboard Edit Mid-Screen Keeps Your Place

A key that adds, splits or moves blocks while the caret sits mid-screen shouldn't lose your place. A reorder or an Enter changes only the blocks it touches, so everything above them stays put and so does the scroll position.

## Happy paths

- Alt+ArrowUp on a paragraph mid-screen, with a tall paragraph just above it: the scroll position doesn't move, and the moved paragraph's top goes up by the tall one's height (within 2px)
  - Miss-analysis: F7 in `vr-anchor-edits` only checks a full up-and-down cycle, where a jump on the way up and its mirror on the way down cancel out, and no test moved a block in the top-level list with the caret in it.
- Alt+ArrowDown on a paragraph mid-screen, with a tall paragraph just below it: the scroll position doesn't move, and the moved paragraph's top goes down by the tall one's height
- Enter at the start of a line mid-screen: the line above it doesn't move (within 1px)
  - Miss-analysis: the split keeps the block's id on its first half, so the page staying put rested on that, and no test pressed Enter with blocks above the caret on screen.
- Enter in the middle of a line mid-screen: the line above it doesn't move
