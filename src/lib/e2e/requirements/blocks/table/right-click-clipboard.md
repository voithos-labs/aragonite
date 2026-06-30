# Feature: table cell right-click clipboard

The cell right-click menu folds in Cut/Copy/Paste so the clipboard stays reachable
after the menu replaced the native one. They act on the cell's selection/caret as
captured when the menu opened, native-equivalent.

## Happy paths

- Right-click a cell with a selection → Copy: the selected text is on the clipboard.
- Right-click a cell with a selection → Cut: the selected text leaves the cell and is on the clipboard.
- Right-click a cell → Paste: clipboard text is inserted at the caret.

## Edge cases

- Collapsed caret: Cut and Copy are disabled; Paste stays enabled.
- Paste over a selection replaces the selected text.
- Cut is a single undo entry.

## Menu surface

- Clipboard items (Cut/Copy/Paste) appear only in the cell right-click menu.
- Row and column grip menus never show clipboard items.
