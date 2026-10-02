# Feature: Keyboard Navigation, Reorder Keeps the Block in View

Alt+ArrowDown and Alt+ArrowUp move the block and the caret goes with it, so the moved block has to stay where you can see it.

## Happy paths

- Alt+ArrowDown on the last block fully on screen, pressed again and again: after each press the moved block is still inside the editor's viewport, because the editor scrolls it back in once it crosses the bottom edge
  - Miss-analysis: every reorder test used a document shorter than the viewport, so nothing ever moved a block off screen.
