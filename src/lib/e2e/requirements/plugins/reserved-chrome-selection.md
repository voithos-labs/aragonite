# Feature: selection reaches the reserved child 0 like any other block

The `:::callout` callout reserves child index 0 as an editable `callout-title` leaf, rendered
inside the callout's single `.block-list`. This early proof shows that selection behaves inside
that title exactly as it does in a built-in block. The checks read behavior: the tree and the
selection read by path through `window.__test`, not visuals.

## Gate 1: selection parity (must pass)

- selecting into it with the keyboard: Shift+End then Shift+ArrowDown from the paragraph above paints one cross-block span whose focus reaches the title leaf (`focus.path === [1, 0]`)
- selecting into it with the pointer: a drag from the paragraph into the title is cross-block with the same deep focus path
- an empty title: selecting in still reaches `[1, 0]` when the reserved title is empty, so an empty child 0 is a real endpoint for a selection
- collapsed caret: collapsing the cross-block selection puts the caret in the title, and a typed character appears there (`activeBlockPath === [1, 0]`)
- undo restores: after a title edit, Ctrl+Z takes the source back and returns the caret to the title leaf

## Substrate

- the seed parses as a real container: the title is a reserved `callout-title` leaf at child 0, the callout round-trips byte for byte, and no error is captured

## User interactions

- Shift+End, Shift+ArrowDown, a pointer drag, ArrowRight and Ctrl+Z are real gestures; the assertions read the tree and the selection by path, never the shape of the DOM
