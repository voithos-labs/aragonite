# Feature: inline-math clipboard while the source is shown

A cut or a paste fired while an inline-math widget is showing its editable `$…$` source has to
commit that source into the tree first, then run against a tree that agrees with the screen, the
same way keydown and IME already hold back the per-keystroke commit while the source is shown.
Without that, the clipboard handler splices into the stale `node.raw` at an offset taken from
the DOM, and the re-render after the paste wipes the text node holding the shown source while
the flag saying it is shown stays stuck, silently dropping everything typed after that until
blur.

Copy is the other half of the same rule: it must never change anything, so it commits nothing,
but a selection over the shown edit, which is not in the tree yet, has to copy the live DOM text
rather than the stale slice of raw.

## Happy paths

- show, type, paste: enter the math source, type two characters, paste one. The serialized
  source carries the shown edit and the pasted character, with the math delimiters intact.
- show, type, copy: enter the math source, type two characters, select the edit and copy. The
  clipboard carries the live DOM text, the source stays open, and the document is untouched,
  since the edit never reached the tree.

## Edge cases

- typing survives the paste: a character typed after the paste reaches the tree, because
  committing the shown source cleared the flag and input is no longer held back.

## User interactions

- ArrowLeft into `$x^2$` to show the source, keyboard typing, a synthetic paste event, keyboard
  typing again, then read the serialized source.

## Error cases

- the regression this guards: without committing first, the shown edit is lost and typing after
  the paste is dropped, so the serialized source contains neither.
