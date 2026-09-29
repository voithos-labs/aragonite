# Feature: Keyboard Navigation, a Keyboard Edit Mid-Screen Keeps Your Place

A key that adds, splits or moves blocks while the caret sits mid-screen shouldn't lose your place. A reorder or an Enter changes only the blocks it touches, so everything above them stays put and so does the scroll position. An edit that lands between the top of the screen and the caret keeps the caret's line still instead, and the content above it takes the shift.

## Happy paths

- Alt+ArrowUp on a paragraph mid-screen, with a tall paragraph just above it: the scroll position doesn't move, and the moved paragraph's top goes up by the tall one's height (within 2px)
  - Miss-analysis: F7 in `vr-anchor-edits` only checks a full up-and-down cycle, where a jump on the way up and its mirror on the way down cancel out, and no test moved a block in the top-level list with the caret in it.
- Alt+ArrowDown on a paragraph mid-screen, with a tall paragraph just below it: the scroll position doesn't move, and the moved paragraph's top goes down by the tall one's height
- Enter at the start of a line mid-screen: the line above it doesn't move (within 1px)
  - Miss-analysis: the split keeps the block's id on its first half, so the page staying put rested on that, and no test pressed Enter with blocks above the caret on screen.
- Enter in the middle of a line mid-screen: the line above it doesn't move
- Delete the tall paragraph by keyboard, click into a paragraph further down, then Ctrl+Z: the block comes back between the top of the screen and the caret, and the caret's line doesn't move (within 1px). Before, it got pushed down by the restored block's height
  - Miss-analysis: a rebuilt list held the block at the top of the screen and never looked at the caret, only a measured one did, and no test changed the block count between the top of the screen and the caret with focus still in the editor.

## Edge cases

- The undo row checks focus is inside a block before the undo, or the list has no caret to hold and the row passes for the wrong reason.
