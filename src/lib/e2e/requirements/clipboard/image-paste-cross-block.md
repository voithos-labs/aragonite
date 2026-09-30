# Feature: image paste over a cross-block selection

An image paste replaces a multi-block selection, like every other paste route. The
range is deleted and the markdown the host hook returned is inserted at the collapsed
caret. Placement inside a single block is its own concern, covered in `image-paste.md`,
which also carries the Playwright synthetic-paste exception these specs inherit.

The image branch hands the work to the cross-block delete rather than to the block that
received the event, because that delete collapses start-wins: the receiving block is the
one merged away whenever the caret sat in the focus block, which is what a mouse drag
leaves. The cross-block code addresses the survivor by path.

## Happy paths

- Caret at the end of the first paragraph, selection extended two blocks down, image
  pasted: the covered blocks are gone, the markdown stands at the collapse point, and
  the document is one block.
- A selection anchored in a table cell is replaced too: the covered body row goes.
- A selection whose last block is an image-only paragraph, image pasted: the focus
  endpoint holds no caret, so the browser dispatches the event at the body and the
  editor-root fallback runs. The host hook is still offered the files, and the
  replacement lands. Both paste entry paths share one image branch; only the landing
  inside a block differs, because the root has no caret to insert at.

## User interactions

- One Ctrl+Z restores the whole selection and removes the markdown: the delete and the
  insertion are one undo entry, not two.
- Typing after the paste continues from the end of the inserted markdown.

## Edge cases

- The cross-block mode is cleared by the replacement, so the next gesture acts on fresh
  offsets rather than a range whose endpoints shifted by the inserted length.
- A multi-block selection made _while_ the import is still in progress is the one that
  gets replaced: the branch reads the selection live, because the cross-block code it
  calls resolves endpoints by path at call time. This is a deliberate difference from
  the single-block branch, which honours the caret held when the paste fired.
- Mirror of the above: a cross-block selection collapsed before the import lands falls
  through to the single-block path and inserts at the caret captured at paste time.
  Pinned by `test/blocks/editable-surface-image-paste.test.ts`.
- At the editor root there is no single-block path to fall through to: a selection
  collapsed while the import was in progress leaves the imported markdown with nowhere
  to land, and the editor reports it on the `error` channel (`origin: 'clipboard'`) so
  the host can release the asset. Pinned by
  `test/components/editor-root-clipboard.test.ts`.
- The hook still decides first: an import that returns `null` for every image destroys
  nothing, since the selection is only replaced once there is markdown to insert. The
  rejection half of that guarantee shares the same code path and is pinned against a
  single-block caret in `image-paste.md`.

## Route parity

- The document produced by an image paste over a cross-block selection is
  byte-identical to pasting the same string as ordinary text over the same selection.
  That is what says the image branch _uses_ the cross-block route rather than
  placing anything itself.
