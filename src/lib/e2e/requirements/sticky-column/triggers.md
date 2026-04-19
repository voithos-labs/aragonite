# Feature: Sticky column — reset vs preserve triggers

Which user actions clear the captured sticky column and which leave it intact. Anything other than plain or shifted vertical arrows resets; vertical arrows (plain or shifted) and IME composition preserve.

## Reset triggers

- Typing a character resets sticky column: the next ArrowDown captures fresh from the post-type caret X
- Click / pointer down resets sticky column: the next ArrowDown captures from the clicked caret X
- ArrowLeft resets sticky column: the next ArrowDown captures from the post-left caret X
- ArrowRight resets sticky column: the next ArrowDown captures from the post-right caret X
- End resets sticky column: the next ArrowDown captures from the end-of-line caret X
- Enter (structural split) resets sticky column: the next ArrowDown captures from the post-split caret X
- Undo resets sticky column: the next ArrowDown captures from the undo-restored caret X

## Preserve triggers

- Shift+ArrowDown (selection extension) does not reset sticky — a subsequent plain ArrowDown still lands at the originally captured column
