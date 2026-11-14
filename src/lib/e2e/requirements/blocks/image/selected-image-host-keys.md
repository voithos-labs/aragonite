# Feature: a selected image and the host's keys

An image selected whole keeps every key the browser could apply to the DOM under it, since that edit would land behind the syntax tree. A key with no editing default goes on to the host page, and `claimsChord` says the same for every key (`claims-chord-parity-surfaces.test.ts`).

## Happy paths

- F5 at a selected image: the keydown is not prevented, so the browser can reload; the image stays selected and the source is unchanged (regression: every key the image did not handle was prevented, F5, Shift+F10 and ContextMenu included; miss-analysis: the claims parity table held the selected image to the keyless row only, so nothing compared what it prevented with what `claimsChord` answered)
- ContextMenu at a selected image: the same

## Edge cases

- A letter at a selected image still replaces it (`Before\n\nx\n\nAfter\n`), with its keydown prevented
- Backspace at a selected image still removes it (`Before\n\n\nAfter\n`), with its keydown prevented
- Alt+ArrowUp at a selected image moves its block above the paragraph before it (regression: the selected image swallowed every modified arrow, the block move's own chord included, and `claimsChord` said the editor took it; miss-analysis: the selected-image rows pressed only keys with no binding and the arrows that leave the image, never a keymap chord on an arrow)
