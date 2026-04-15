# Feature: Code Block Editing Conveniences

Auto-indent on Enter, electric indent around empty bracket pairs, and auto-close for brackets and quotes. Applies to fenced code blocks only — prose blocks retain their markdown semantics.

## Auto-indent on Enter

- Enter at the end of an indented line begins the next line with the same leading whitespace
- Indent preserves tabs and spaces verbatim — no normalization
- Enter at the end of a line with no indent behaves as today (bare newline)
- Enter in the middle of an indented line leaves the prefix on the original line and starts the remainder on a new indented line
- Enter on a blank line with a leading indent keeps the indent on the next line
- Auto-indent does not change the exit-on-double-Enter path for closed fences

## Electric indent

- Enter between an empty opener/closer pair (`(|)`, `[|]`, `{|}`) expands into three lines: the opener line, an extra-indented middle line where the cursor lands, and the closer line at the original indent
- Quote pairs (`"|"`, `'|'`, `` `|` ``) do NOT trigger electric indent — they stay inline
- The extra indent level is one tab character (matching the Tab key's behavior)

## Auto-close brackets

- Typing `(`, `[`, or `{` with a collapsed cursor inserts the pair and leaves the cursor between them
- Auto-close is suppressed when the next character is an identifier char (`[\w$]`): `(` typed before `foo` inserts only `(`
- Auto-close is NOT suppressed when the previous character is an identifier: `foo(` pairs normally
- Typing a bracket with a non-empty selection wraps the selection in the pair and keeps the selection inside

## Auto-close quotes

- Typing `'`, `"`, or `` ` `` with a collapsed cursor inserts the matching quote pair
- Auto-close is suppressed when either the next OR the previous character is an identifier: `don|t` + `'` inserts only `'` (the apostrophe case), and `'don|` + `'` also inserts only `'` (closing an open string)
- A typed quote with a non-empty selection wraps the selection

## Skip-over

- Typing `)`, `]`, `}` when the next character already matches moves the cursor past the existing closer without inserting a duplicate
- Typing `'`, `"`, or `` ` `` when the next character matches behaves the same way
- Skip-over is stateless — it fires whenever the adjacent character matches, regardless of how that character got there

## Backspace pair-delete

- Backspace with a collapsed cursor sitting between a matching empty pair (`(|)`, `"|"`, etc.) removes both characters in one keystroke
- Regular Backspace behavior (single-char delete, Backspace at offset 0 moves focus) is preserved when the cursor is not in an empty pair

## Undo atomicity

- Each auto-pair insertion undoes in one Ctrl+Z to the pre-type state
- A Backspace pair-delete undoes in one Ctrl+Z

## Interaction with highlight.js

- Auto-indent and auto-close work inside a `js`-tagged code block where the body is fragmented into multiple token spans
- The cursor lands at the intended offset after each operation, even after the tokenizer rebuilds the span tree
