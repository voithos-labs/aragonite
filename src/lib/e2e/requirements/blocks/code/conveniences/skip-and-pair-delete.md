# Feature: Code Block — Skip-Over and Pair-Delete

Closing-character skip-over avoids duplicating an existing closer; Backspace between an empty pair removes both characters.

## Skip-over

- Typing `)`, `]`, `}` when the next character already matches moves the cursor past the existing closer without inserting a duplicate
- Typing `'`, `"`, or `` ` `` when the next character matches behaves the same way
- Skip-over is stateless — it fires whenever the adjacent character matches, regardless of how that character got there

## Backspace pair-delete

- Backspace with a collapsed cursor sitting between a matching empty pair (`(|)`, `"|"`, etc.) removes both characters in one keystroke
- Regular Backspace behavior (single-char delete, Backspace at offset 0 moves focus) is preserved when the cursor is not in an empty pair
