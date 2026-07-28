# Feature: cross-block clipboard — the event that lands on no block

A cross-block selection is painted by overlays, and the caret the selection seam parks at
the focus endpoint is best-effort: when that endpoint's block hosts no text position (an
image-only paragraph, a thematic break), the native selection is left empty or outside the
focused surface, and Chromium then dispatches `copy`/`cut`/`paste` at `document.body`
instead of at the block. Nothing above the block surfaces used to listen, so the whole
gesture died silently.

## Happy paths

- Select-all over a document whose last block is an image-only paragraph, then Ctrl+C:
  the system clipboard carries the whole document.
- Same document, Ctrl+X: the clipboard carries the whole document and the document empties.
- Same document with a cross-block selection, Ctrl+V: the pasted text replaces the selection.

## Edge cases

- The class is not about images: a document whose last block is a thematic break escapes
  the same way, and Ctrl+C must still copy the whole document.
- A cross-block copy that a block surface DOES receive keeps writing exactly once — the
  root fallback must not double-write or overwrite the block's payload.
- The listeners sit on `document`, so every copy on the page enters them. Copying from a
  host header field mounted inside the editor root (`?header=on` — both its `<input>` and
  its `contenteditable`) and from the find bar's input each yields that surface's own
  text, never the document, even with a whole-document range live.
