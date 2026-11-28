# Feature: A line break over a range writes where text would

Enter, Shift+Enter and a soft keyboard's two breaks over a range go where text typed over it goes: before the rest of the text the range ended in, else on a line it emptied, else in an empty paragraph opened where the range was. No break writes in a block the range did not reach. Each row presses the key, then types `x`, in source and live mode.

Miss-analysis: the break rows ran in jsdom only and pinned the break at the end of the block before, so Chromium never checked that a break stays out of a block the range did not reach.

## Happy paths

- Shift+Enter over a divider and a heading held whole, a paragraph before them: the break and the letter stand in an empty paragraph where they were (`first\n\n\\\nx`); never `first\` and the letter on its next line.
- Enter over the same blocks under a fence: an empty paragraph where they were takes the letter; no line goes into the code.
- Shift+Enter over the same blocks under a fence: the break stands in that paragraph.

## Edge cases

- Shift+Enter over a quote's last blocks, the quote tight: the break stays inside the quote, on a line of its own under the paragraph above (`> above\n>\n> \\\n> x`).
- Shift+Enter over a divider held whole between two paragraphs: the break stands in an empty paragraph where the divider was, never at the end of the paragraph above.
- Enter or Shift+Enter over a divider held whole flush between two lines (`first\n***\nlast`): one empty paragraph where the divider stood takes the break and the letter (`first\n\nx\n\nlast`), never `last` joined up under `first`.
  Miss-analysis: every held-whole row stood the divider a blank line from its neighbours, so no row saw its removal rejoin the two lines it sat between.
- Enter over a divider held whole that is a list item's only block, a quote's last block or a callout's last block: the one empty line where the divider stood takes the letter (`- a\n- x\n- last`, `> a\n>\n> x`, `:::note\nfirst\n\nx\n:::`), never a second line opened beside the one the container kept.
  Miss-analysis: the held-whole rows held a divider at the top level alone, where its removal keeps no line, so no row saw the place open a second line beside the one a quote or an item keeps.
