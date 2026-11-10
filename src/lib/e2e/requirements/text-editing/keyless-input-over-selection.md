# Text editing: input with no key goes to what the editor has selected

A soft keyboard, dictation and an emoji picker send text, deletes and line breaks with no key press. While the editor holds a selection of its own (a range across blocks, a picture selected whole), the browser aims that input at a caret nobody sees. The selection takes it instead, and does what the matching key does. Every row runs in source and live mode.

A delete or a break with no key is the browser's own command (`e2e/insert-text.ts` :: `keylessEdit`). WebKit fires the `beforeinput` for it; Chromium and Firefox fire none for a scripted command, so there the harness sends it first, and those two columns say what the editor does with the event, not what the engine would send.

## Happy paths

- a range across two paragraphs, a backward delete with no key: the document reads as it does after Backspace over the same range
- the same, a forward delete: as after Delete
- the same, a line break: as after Shift+Enter
- the same, a paragraph break: as after Enter

## Edge cases

- a picture selected whole, `*` with no key: the `*` replaces the picture and no pair is written (`lead * tail`)
- the same with a backtick: the backtick replaces the picture, unpaired
- a picture selected whole, a backward or a forward delete with no key: the picture goes, as Backspace and Delete take it. Every picture row runs from both edges (a click leaves the hidden caret at the picture's end, ArrowRight onto it at its start), since a delete the picture didn't claim takes a different neighbour from each
- the same, a line break or a paragraph break: nothing is written and the picture stays selected, as Enter and Shift+Enter leave it

## Pinned below the browser

- `test/selection/held-input.test.ts`: which inputs are the selection's (text, a delete from the keyboard, a break, a replacement, a format command) and which aren't (an IME's, undo, a paste or a drop, the delete half of a cut or a drag); a range claims text, deletes and breaks, and refuses a replacement or a format command, as a selected widget does.
- `test/blocks/text/widget-selected-input.test.ts`: over a widget selected whole, text replaces it, a delete in either direction removes it, and a break, a replacement or a format command is refused with the widget still selected.

## Miss-analysis

- Only text was claimed for a range, and no row sent a delete or a break with no key, so a soft keyboard's Backspace over a range took one character at the hidden caret and left the range standing.
- A selected picture's claim ran after the block's own input steps, and no row sent it a character the auto-pair takes, so `*` from a soft keyboard wrote `**` at the paragraph's start.
