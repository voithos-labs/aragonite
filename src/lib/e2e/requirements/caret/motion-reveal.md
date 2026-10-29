# Caret: a caret key the editor lands shows the caret

The browser scrolls the caret into view after its own caret key moves it. A key the editor lands
(`caret/caret-motion.ts`) writes the caret itself, through the selection API or a line move that
scrolls nothing, so the editor scrolls it into view the same way: every box around the block that
scrolls sideways first, then the page (`selection/show-caret.ts`).

## Happy paths

- a caret at column 20 of a 400-character code line, End: the code block scrolls until the caret is
  inside its box
- the same, End then Home: the block scrolls back until the caret at the line's start is inside it
- the same, the word key twice (across `value` and the long run of `x`): the caret at the run's end
  is inside the block's box
- a code block of 200 lines, taller than the window, the block-end key from its first line: the page
  scrolls until the caret is inside the window

## Miss-analysis

- The lane's class rows checked where each key lands in raw offsets, never whether the caret could
  be seen there, and the one row that did (`drawn-caret-layout`, End in a long code line) wasn't in
  the lane's runs; the merge gate caught it.
