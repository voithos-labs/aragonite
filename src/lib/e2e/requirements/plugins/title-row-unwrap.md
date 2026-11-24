# Feature: a selection that breaks a `:::` opening row unwraps the box

A `:::` container opens with a row (`:::tip Title`) and closes with a line of colons. A selection
removed from that row which leaves it fewer than three colons takes the rest of the row's syntax
and the closing line too: what is left of the title stands as a paragraph, a blank line, then the
body as ordinary blocks. Driven on `/test/plugins?seed=admonitions` in live and source mode, the
marker held by keys (live: ArrowUp from the body, Shift+Home; source: ArrowUp, Shift+ArrowRight
seven times).

Miss-analysis: every row over an opening row was a range that ran off it or a key at a caret, so
none removed a selection inside the row, and the closing line it left read as text.

## Happy paths

- `:::tip ` selected, then Backspace, Delete or Ctrl+X: `Title`, a blank line, `body`
- The same, then a letter: the letter starts the paragraph (`QTitle`), a blank line, `body`
- The same, then Cut from the right-click menu: as Ctrl+X
- The same, then an IME composition: the committed text starts the paragraph
- The colons selected by the selection API, then Backspace: as above
- The same marker, then Shift+Enter: the box goes before the key runs

## Edge cases

## User interactions

## Error cases
