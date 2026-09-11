# Feature: the trailing insert row and the block menu

Below the last block sits a full-width row: a click on it appends an empty paragraph and lands
the caret there, so there is always somewhere to write after a table, a fence or an equation.
Its gutter `+` does the same and opens the insert menu over the new paragraph: the empty blocks
(lists, a to-do list, a quote, a divider, a code block, a table, a plugin's blocks while it is
installed) and, below a divider, the clipboard rows. A right-click on a non-prose block opens
that block's actions (its kind's registered rows, then copy, replace with clipboard, remove).
Every menu is driven by pointer or keyboard without taking focus, and announces itself on the
`menuChange` channel so host chrome over the selection can step aside.

## Happy paths

- clicking the tail row on a document ending in a code block appends a paragraph, and the next
  keys type into it
- the `+` appends the paragraph and opens the insert menu (`Insert a block`); ArrowDown steps
  the active row, Enter inserts the row's Markdown at the caret, and typing continues inside
  the minted block
- ArrowUp from the first row wraps to the last selectable row; ArrowDown wraps back
- a right-click on a code block opens `Block actions`; its Remove row deletes the block and
  the neighbours close up

## User interactions

- Escape closes the menu and inserts nothing; the caret stays in the paragraph the `+` minted
- `menuChange` fires `true` once as the menu opens and `false` once as it closes, never at mount

## Error cases

- zero `[invariant:…]` console fires across the menu interactions (automatic via the shared
  e2e fixture)
