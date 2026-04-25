# Feature: Sticky Column — Reset Triggers

User actions that clear the captured sticky column. Anything other than plain or shifted vertical arrows resets.

## Reset triggers

- Typing a character resets sticky column: the next ArrowDown captures fresh from the post-type caret X
- Click / pointer down resets sticky column: the next ArrowDown captures from the clicked caret X
- ArrowLeft resets sticky column: the next ArrowDown captures from the post-left caret X
- ArrowRight resets sticky column: the next ArrowDown captures from the post-right caret X
- End resets sticky column: the next ArrowDown captures from the end-of-line caret X
- Enter (structural split) resets sticky column: the next ArrowDown captures from the post-split caret X
- Undo resets sticky column: the next ArrowDown captures from the undo-restored caret X
