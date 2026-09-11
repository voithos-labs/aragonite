# Feature: vertical arrows leave a selected image

A click on an inline image selects it as a whole (the overlay and its toolbar mount). From that
state the horizontal arrows step the caret out to the image's own edges or to the neighbouring
block; the vertical arrows owe the same exit, since a selected image is a whole-block stop like a
divider or a folded equation, and a key that does nothing there strands the keyboard user.

## Happy paths

- ArrowDown on a selected image lands the caret in the block below, so the next key edits it
- ArrowUp on a selected image lands the caret in the block above
- both hold in source and live mode, and for an image sitting in a `<details>` body as much as
  for one at the top level: the exit is the image's, not the container's

## Edge cases

- the image's own bytes never take the key: nothing is typed into the `![...](...)` span

## Error cases

- zero `[invariant:…]` console fires (automatic via the shared e2e fixture)
