# Feature: A key typed over whole blocks leaves the block below alone

A range that holds whole blocks (a divider, then a heading to its end) leaves no text at either end, so a key typed over it stands on a line of its own where the blocks were. The block below keeps its bytes and its kind, and stays a blank line apart, the next letter included. Each row holds the divider whole with a drag, Shift+clicks the heading's end, types the key and then `x`, in source and live mode.

## Happy paths

- A typed `>` over the divider and the heading, a paragraph below: an empty quote where they were, and `x` goes into it (`first\n\n> x\n\nlast`); `last` stays a paragraph of its own, never a line of the quote.
  Miss-analysis: the rows typed letters and pair characters over whole blocks, never a block marker, the one key whose paste reads as an empty block and took no blank line under it.
- A typed space over the same blocks, a code block below: the space and `x` stand in a paragraph of their own (`first\n\n x\n\n```…`); the fence keeps its opening line.
  Miss-analysis: no row typed blank text over a range, the one key whose paste reads as no block, so it went in at the fence's first byte.
