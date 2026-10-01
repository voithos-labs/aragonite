# Feature: Source prop change

Editor re-initialization when the `source` prop changes (async document load, shell document swap, test harness reload). Latent in the current app: it fires the moment anything dynamically swaps the prop.

## Happy paths

- `setSource` on fresh editor: content loads, editor ready for typing
- `setSource` after edits: new content replaces current document
- `setSource` announces itself: each swap fires `sourceSwap` once, its generation one above the
  last, and fires no `edit` event, so a host marking the document dirty on `edit` never hears its
  own write echoed back

## Edge cases

- a key typed just before `setSource`, inside the undo batch's pause: its `edit` fires as the key
  lands, and the swap fires none, so a host echoing `getSource()` on `edit` never writes the
  outgoing text back over the document it just loaded
- an empty heading holding the caret at `setSource`: the swap's teardown blurs it, and the blur's
  tidy-up (an empty `#` turns back into a paragraph) is refused rather than written into the next
  document; a dev build reports the refused write
- a menu paste still reading the clipboard at `setSource` (the prose menu's Paste, the block
  menu's Replace with clipboard): the read finishes after the swap, and its text lands nowhere;
  a dev build reports the refused write

- `setSource` while cross-block selection is active: cross-block state clears (no stale anchor/focus paths against the new doc), `data-cross-block` removed from editor root, typing inserts visible characters at the collapsed caret
- `setSource` while undo stack has entries: stack clears (already covered by existing init behavior; listed here for completeness)
- `setSource` while decoration sources are registered: the edit generation counter advances and every source re-provides against the new document (owned by `decorations/source-swap-epoch.md` and `search/source-swap-rescan.md`, which drive the shipped consumers)

## User interactions

- Simulate shell document swap: `loadContent` doc A → enter cross-block via Shift+ArrowDown → `loadContent` doc B → assert cross-block cleared and typing produces visible characters

## Miss-analysis

- The silent swap (#263) shipped because the one spec for this prop checked what the swap resets,
  and nothing subscribed to the events a host or a plugin would use to tell a swap from a keystroke.
- The held typing `edit` firing inside a swap (#683) shipped because every swap row loaded its
  document long after the last key, so the typing pause had always run out first.
- The heading tidy-up landing in the next document shipped because no swap row left the caret
  in a block whose blur writes; every blur write was tested against the document it came from.
- The menu pastes landing in the next document shipped because every menu-paste row read a
  clipboard that answered at once, so nothing could happen between the pick and the write.
