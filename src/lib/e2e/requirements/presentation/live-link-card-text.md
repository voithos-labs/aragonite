# Feature: the link card's Text field

The live-mode link card holds the link's text in a field above its URL, the way Google Docs' link
card does, for editing a link and for creating one. Enter in either field writes both as one undo
entry. The field shows the text you see; it's read-only when that text holds formatting or code,
since editing raw markers as plain text would break the link. A new text keeps a reference's
destination: `[t][ref]` keeps its label, and the collapsed and shortcut forms are written
`[new][old label]`, so the definition line stays as it was. Characters that would end the link
early or format it are escaped, so the link shows exactly what was typed. Autolinks get no card,
as before. Driven on `/test/editor` via `?presentationMode=live` with real clicks, real typing and
a real `Mod+Z`.

Miss-analysis (#807): the card had one field, so a link's text could only be changed by typing
over it in the document, and no scenario covered renaming a link while keeping its destination.

## Happy paths

- clicking a rendered link opens the card with a Text field above the URL, holding the link's text
- a new text with spaces in it, then Enter, writes `[my new link](url)` and closes the card
- a full reference keeps its label; a collapsed or shortcut reference becomes `[the site][example]`,
  the definition line untouched

## Edge cases

- a text holding `]`, `(`, `)`, `|` and `*` shows exactly those characters once written
- an emptied Text field refuses Enter: nothing is written and the card stays open
- a link whose text is bold shows `bold text` read-only, and a URL edit still writes

## Undo

- a text and a URL changed together, then one undo: the link is back as it was, since the card's
  commit is one entry

## Create

- `Mod+K` over a selection starts the Text field from the selected text; a changed text and a URL,
  then Enter, write `[delta echo](url)` over the selection, and one undo takes it back
