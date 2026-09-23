# Feature: Source prop change

Editor re-initialization when the `source` prop changes (async document load, shell document swap, test harness reload). Latent in the current app: it fires the moment anything dynamically swaps the prop.

## Happy paths

- `setSource` on fresh editor: content loads, editor ready for typing
- `setSource` after edits: new content replaces current document
- `setSource` announces itself: each swap fires `sourceSwap` once, its generation one above the
  last, and fires no `edit` event, so a host marking the document dirty on `edit` never hears its
  own write echoed back

## Edge cases

- `setSource` while cross-block selection is active: cross-block state clears (no stale anchor/focus paths against the new doc), `data-cross-block` removed from editor root, typing inserts visible characters at the collapsed caret
- `setSource` while undo stack has entries: stack clears (already covered by existing init behavior; listed here for completeness)
- `setSource` while decoration sources are registered: the edit generation counter advances and every source re-provides against the new document (owned by `decorations/source-swap-epoch.md` and `search/source-swap-rescan.md`, which drive the shipped consumers)

## User interactions

- Simulate shell document swap: `loadContent` doc A → enter cross-block via Shift+ArrowDown → `loadContent` doc B → assert cross-block cleared and typing produces visible characters

## Miss-analysis

- The silent swap (#263) shipped because the one spec for this prop checked what the swap resets,
  and nothing subscribed to the events a host or a plugin would use to tell a swap from a keystroke.
