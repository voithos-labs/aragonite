# Feature: `onPasteImage` — host hook for image-bearing pastes

A host that stores assets of its own (an app importing pasted screenshots) installs
`onPasteImage`. When a paste carries image files, the editor hands each one to the
hook in clipboard order and inserts the markdown the hook returns at the caret the
paste started from. Without the hook, an image-bearing paste behaves exactly as it
did before: native default prevented, the clipboard's `text/plain` (if any) pasted.

**Playwright exception:** a real image cannot be written to the system clipboard from
a spec — `navigator.clipboard.write` with an image blob is not scriptable under the
test runner. These specs construct a `DataTransfer` carrying a `File` and dispatch a
synthetic `paste` event on the focused block, which enters the editor at the same
`onPaste` handler a real paste does. Caret placement, undo, and every assertion stay
real user actions. The harness installs the hook via `?imagePaste=on` (the prop is
set-once at mount) and swaps its per-image response through `window.__test.imagePaste`.

## Happy paths

- One image pasted into a paragraph with the caret mid-text, hook returns `![[a.png]]`:
  the markdown lands at the caret, splitting the surrounding text at that point.
- Two images in one paste: both markdown strings land at the captured caret in
  clipboard order — the second immediately after the first.
- The hook receives the file's MIME type and its name as `suggestedName`.
- An image pasted over a selection replaces it, like every other paste route: the
  selection's text is gone and the markdown stands in its place.
- The same insertion works on the other editable surfaces — a table cell keeps the
  markdown inside that cell, a code block takes it as literal source — and the tree
  stays convergent in both.

## Edge cases

- Hook returns `null`: nothing is inserted, no error is emitted, the document is
  unchanged — and the paste is still consumed (no `text/plain` fallback).
- Hook returns `null` for one of two images: only the other image's markdown lands.
- Caret moved elsewhere while a slow hook is still resolving: the markdown lands at
  the caret held when the paste fired, not where the caret now sits.
- Clipboard carries a non-image file (a `.txt` attachment) plus text: the image arm
  declines and the ordinary `text/plain` paste runs.
- The block holding the captured caret is gone by the time a slow hook resolves
  (windowed out, or the document was replaced): nothing is inserted and an `error`
  event is emitted. The insertion is declined rather than landing at a guessed offset.
  Pinned by `test/blocks/editable-surface-image-paste.test.ts` — unmounting a block
  mid-import is not reachable through a user gesture at e2e level.
- Cross-block selection active when an image is pasted: the arm runs before
  cross-block paste handling, so the selection is NOT deleted — the markdown is
  inserted and the selected blocks stay. The tree stays convergent either way; this
  is pinned so a future change to the arm's position is a decision, not a surprise.

## User interactions

- Ctrl+Z after an image paste removes all of that paste's markdown in one step: one
  paste gesture is one undo entry, however many images it carried.
- Typing after the paste continues from the end of the inserted markdown.

## Error cases

- Hook rejects: an `error` event fires with `origin: 'command'`, nothing is inserted
  for that image, and the editor stays editable (typing still commits).
- Hook rejects on the first of two images: the error is emitted and the second
  image's markdown still lands — one failed import does not abort the paste.

## Without the hook

- No `onPasteImage` installed, clipboard carries an image file and `text/plain`:
  the text is pasted, exactly as before the hook existed.
