# Block: List — Shift+Enter

Shift+Enter inside a list item is the hard break every prose block takes (`block.hardBreak`),
not a new item: the item's paragraph gains a `\` line break, the item paints a second line, and
the next keys type on it.

## Happy paths

- Shift+Enter at the end of `- item`, then typing, yields one list block whose item reads
  `item\` over `more` on the next line, painted as two lines.

## Regression guards

- The block count stays one: the break never splits the item or the list.
