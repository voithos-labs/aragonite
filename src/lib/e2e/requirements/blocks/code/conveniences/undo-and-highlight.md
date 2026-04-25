# Feature: Code Block — Undo Atomicity and Highlight.js Interaction

Each convenience operation undoes in one Ctrl+Z; conveniences also work inside highlighted code blocks where the body is fragmented into token spans.

## Undo atomicity

- Each auto-pair insertion undoes in one Ctrl+Z to the pre-type state
- A Backspace pair-delete undoes in one Ctrl+Z

## Interaction with highlight.js

- Auto-indent and auto-close work inside a `js`-tagged code block where the body is fragmented into multiple token spans
- The cursor lands at the intended offset after each operation, even after the tokenizer rebuilds the span tree
