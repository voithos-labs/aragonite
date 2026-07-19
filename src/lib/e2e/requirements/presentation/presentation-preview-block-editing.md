# Feature: block-granular live preview — editing stays live (rung 2)

`presentationMode="preview-block"` is an EDITING mode: unlike reading mode, no
edit path is gated. Typing, Enter/Backspace structural edits, undo, cross-block
selection, and search all keep working over the marker-hidden blocks. The focus
attribute follows the caret through structural edits so the block being typed
into always shows its source. Driven on `/test/editor` via the "Block preview"
toggle.

## Happy paths

- typing in the focused block commits normally and the source round-trips
  byte-for-byte
- undo after an edit restores the prior source
- a task checkbox stays live (clicking it toggles the task — this mode edits)

## Edge cases

- Enter-to-split in preview-block moves `data-focused` to the new block: the new
  block shows its markers, the old block hides them
- Backspace-to-merge moves `data-focused` onto the merged block, which shows its
  markers
- cross-block selection painted over marker-hidden blocks highlights the same
  visible text a source-mode selection would (overlay rects come from live layout)

## User interactions

- click a block, type text, read the source through the bridge: the typed text is
  present and the document still round-trips
- select across two blocks (shift+arrow or drag): the cross-block overlay appears
  and copy yields the selected text
- open find and search a term present in a hidden-marker block: the match
  highlight lands on the visible occurrence

## Mode transitions

- flipping preview-block → reading → source → preview-block leaves the source
  byte-stable and never fires an invariant
- flipping to reading blurs the caret (no block stays marked focused)
- flipping the `presentationMode` prop into preview-block while a block stays
  focused (no re-focus — the consumer path) marks that block: it reveals its
  markers (the mode reconcile, distinct from the focusout the header toggles fire)

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
