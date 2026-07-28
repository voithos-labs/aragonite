# Feature: Inline Editing — Formatting Shortcuts at a Collapsed Caret

Mod+B / Mod+I with no selection. They used to bail on the null selection while still
swallowing the key, so the chord did nothing a user could see. The contract now:
unwrap the span the caret sits inside, else remove the empty pair a previous press
left, else insert the pair and put the caret between its halves.

## Happy paths

- Ctrl+B at a collapsed caret inserts `****` and the next typed character lands inside it.
- Ctrl+I at a collapsed caret inserts `**` and the next typed character lands inside it.
- Ctrl+B pressed twice in a row leaves the text exactly as it was.
- Ctrl+B with the caret inside `**bold**` removes the bold.

## Edge cases

- Ctrl+B at a caret in the middle of a plain word inserts the pair there — it does not
  toggle the whole word (no word-boundary rule exists in this editor).
- One Ctrl+Z after the insert removes the pair and restores the caret's text.
- Text typed inside the pair joins the same undo entry: one Ctrl+Z removes the pair AND the
  typing. The toggle joins the typing checkpoint it opened, the ordinary batching rule for a
  content edit at a caret.
- In a table cell, Ctrl+B at a collapsed caret inserts the pair through the CST and
  never lets the browser's own bold command inject a `<b>` element.
