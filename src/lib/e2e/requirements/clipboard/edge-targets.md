# Clipboard: Edge Targets

Paste / cut into unusual positions: empty document, heterogeneous clipboard, cut-then-paste round-trip, append at end-of-doc.

## Happy paths

- Paste into an empty document places the clipboard content.
- Paste multi-block clipboard into empty document preserves block structure.
- Paste a heading and its line ending over a list item's whole text: the item holds the heading's line, and the line ending opens the next item, empty.
- Cut across two list items removes selection, leaves surviving items intact, puts removed content on clipboard.
- Cut-then-paste round-trip restores the original content.
- Paste at end of last block appends correctly.

## Pinned below the browser

An empty clipboard is a no-op: the block's paste step never runs
(`test/blocks/editable/surface-clipboard.test.ts`).
