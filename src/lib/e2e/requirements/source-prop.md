# Feature: Source prop change

Editor re-initialization when the `source` prop flips (async document load, shell document swap, test harness reload). Latent in the current app — fires the moment anything dynamically swaps the prop.

## Happy paths

- setSource on fresh editor: content loads, editor ready for typing
- setSource after edits: new content replaces current document

## Edge cases

- setSource while cross-block selection is active: cross-block state clears (no stale anchor/focus paths against the new doc), `data-cross-block` removed from editor root, typing inserts visible characters at the collapsed caret
- setSource while undo stack has entries: stack clears (already covered by existing init behavior; listed here for completeness)
- setSource while decoration sources are registered: the edit epoch advances and every source re-provides against the new document (owned by `decorations/source-swap-epoch.md` and `search/source-swap-rescan.md`, which drive the shipped consumers)

## User interactions

- Simulate shell document swap: loadContent doc A → enter cross-block via Shift+ArrowDown → loadContent doc B → assert cross-block cleared and typing produces visible characters
