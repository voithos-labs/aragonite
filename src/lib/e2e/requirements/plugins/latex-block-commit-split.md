# Feature: Block math commit kernel, edits past the fence re-split the document

Committing a `$$…$$` source that has been edited so it no longer parses as one block has to land
as a structural replacement: the math block plus every trailing block the text parses into.
Before this, the trailing text was crammed into the math node, because parsing back to the same
kind only wrote raw bytes, and the block was left showing a stuck KaTeX error until reload.
Seed: `Before` / `$$x^2$$` / `After`.

## Happy paths

- Show the source, append a blank line and `hello` after the closing fence, then blur: the
  document splits into math plus paragraph (`Before`, `$$x^2$$`, `hello`, `After`), the math
  re-renders as clean KaTeX, and the round trip is stable
- Show the source, delete both `$$` fences, then blur: the block becomes a paragraph `x^2`, so
  changing the kind still works through the factory

## Edge cases

- The commit on blur ends with a live caret in a predictable place: closing the source relayouts
  under the pointer during the blurring click and swallows that click's focus, which Chromium
  drops to `body`, so the commit puts the caret back at the edit position in the paragraph that
  split off. (When the blur's focus transfer does succeed, because nothing relayouts under the
  pointer, the structural commit sees that focus has moved on and leaves it alone; that is
  covered by the unit check on focus after a replacement.)
- Undo after the split restores the single math block as it was before the edit, in one step, so
  showing the source, editing it and blurring is one undo entry
