# Feature: table cell right-click clipboard

The cell right-click menu carries Cut/Copy/Paste, so the clipboard stays reachable
now that the menu has replaced the browser's own. They act on the cell's selection or
caret as it stood when the menu opened, the same as the browser's items would.

## Happy paths

- Right-click a cell with a selection → Copy: the selected text is on the clipboard.
- Right-click a cell with a selection → Cut: the selected text leaves the cell and is on the clipboard.
- Right-click a cell → Paste: clipboard text is inserted at the caret.

## Edge cases

- Collapsed caret: Cut and Copy are disabled; Paste stays enabled.
- Paste over a selection replaces the selected text.
- Cut is a single undo entry.

- Paste picked while the host loads another document (the clipboard read held until the swap
  is done): the text lands nowhere, the next document is exactly what was loaded, and a dev
  build reports the refused write

## Menu surface

- Clipboard items (Cut/Copy/Paste) appear only in the cell right-click menu, at its top level.
- The Row and Column flyouts carry only their axis's inserts and moves, never a clipboard item.
