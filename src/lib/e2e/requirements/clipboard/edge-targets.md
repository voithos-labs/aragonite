# Clipboard Exploration: Edge Targets

Paste / cut into unusual positions — empty document, heterogeneous clipboard, cut-then-paste round-trip, append at end-of-doc, empty clipboard no-op.

## Happy paths

- Paste into an empty document places the clipboard content.
- Paste multi-block clipboard into empty document preserves block structure.
- Paste heading into a fully-selected list item produces the heading (structural path).
- Cut across two list items removes selection, leaves surviving items intact, puts removed content on clipboard.
- Cut-then-paste round-trip restores the original content.
- Paste at end of last block appends correctly.
- Paste empty clipboard is a no-op: the document stays byte-identical, not merely still-containing its text — a stray newline or a duplicated block is a failure.
