# Feature: "Insert block" in the prose right-click menu

The right-click menu on a paragraph or heading carries the clipboard rows and, below a divider,
an "Insert block" flyout listing the empty blocks the editor can add (lists, quote,
divider, code block, table, and a plugin's blocks while it is installed). Choosing one creates an
empty paragraph after the block under the pointer and puts the snippet in it, so the new block is
empty and the caret is inside it.

## Happy paths

- Right-click a paragraph, open the flyout (hover, click or ArrowRight), pick "Code block": an
  empty fence appears after that paragraph, before the next block.
- Any other entry works the same way; the list is the block registry's, so a plugin's block
  appears there while the plugin is installed.

## Where the row is absent

- Inside a table cell (the table's own menu), a code fence, an equation showing its source, or any
  nested block (a list item, a blockquote child): a sibling there is not what the click meant, so
  the menu is the clipboard alone.
- Over a live selection: the menu is the selection's clipboard menu.

## Interactions

- Keyboard follows the table menu's flyout contract: Right opens on the first item, Left returns
  to the row, Escape closes.
