# Feature: the right-click menu over a range the editor holds

A range across blocks is the editor's own: it paints the range itself and leaves the browser's selection a caret. A right-click on the painted range keeps it and offers Cut and Copy over it, as one on the browser's range does (`context-menu-press-selection.md`); a right-click anywhere else ends it, as a click there would, and opens the menu of what's under the pointer. Most rows start from a range from `first` into `last`, with a list, a quote, a rule and a table between them and the same four again below `last`.

## Happy paths

- Right-click a list item's marker, a quote's rail, the rule and a table cell's padding inside the range: each keeps the range, with Cut and Copy on and no Insert block.
- The menu's Copy over the range: the clipboard holds what Ctrl+C writes, and the document is unchanged.
- The table cell menu's Cut over the range: the document and the clipboard end exactly as Ctrl+X over the same range leaves them.
- Drag inside a rule, right-click it, pick Paste with `pasted` on the clipboard: the rule is replaced by the clipboard's block, as Ctrl+V does there.

## Edge cases

- Right-click the same four targets below the range: each ends the range and opens the menu of what's under the pointer.
- Right-click the first line's text before the range starts, where nothing is painted: the range ends and the prose menu opens with Insert block.

## Miss-analysis

- Right-clicking inside a range across blocks offered Cut and Copy disabled and Insert block (#820): the right button's own press ended the range before the menu opened, and the menu then asked the browser's selection, a caret under every range the editor holds. Every right-click test selected inside one block, where the browser holds the range, and the table cell menu read only the cell's own selection or a rectangle inside its table.
- The menu's Paste over a rule held whole pasted nothing: it aimed at the focused block, and a range holding one block whole parks focus on the editor root. No test picked a menu row over such a range.
