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

- An untitled row selected whole: `body` alone, no paragraph above it
- In source mode the titled row selected whole (Shift+End): `body` alone
- The inner box of a `::::note` over a `:::tip`: the inner box only unwraps, inside the note
- In a quote and in a list item: the paragraph, a blank line behind the markers, the body
- A generic `:::foo` box unwraps as a callout does
- A body that opens with a heading stays flush under the paragraph; one that opens with a rule gets a blank line, so the rule stays a rule
- One colon selected by keys: the box unwraps

## User interactions

- After the unwrap the caret stands at the start of `Title`, so a letter starts it
- `:::tip ` selected, `:` typed, then `::note `: each key lands where typed (`:Title`, then `:::note Title`), no character lost, two paragraphs and no box
- A cut, then Ctrl+V where it left the caret: the box back, byte for byte
- `:::tip ` pasted from outside the editor at the start of `Title`: two paragraphs, no box
- Undo after the unwrap gives the box back; redo unwraps it again

## Controls

- The name selected (`tip`), then Backspace: `::: Title`, the closing line kept, so a name typed next re-forms the box
- Backspace, a word delete or a soft keyboard's delete at a caret after the colons: today's bytes, the closing line kept
- In live mode the titled row selected whole: the title clears and `:::tip ` stays
