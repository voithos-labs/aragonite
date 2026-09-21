# Feature: Code Block Highlighting

Syntax highlighting for code blocks: the token spans a known language produces, the styling of the info string, what an unknown language falls back to, and alias resolution.

## Highlighting

- tokenization renders spans for known languages: a `js` code block containing `const x = 42;` has at least one `.code-tok-keyword` span
- info string rendered with .md-lang class: the language name on the opener line carries the `.md-lang` class for its own styling
- unknown language falls through to plain text: a `klingon` info string produces no `.code-tok-*` spans in the body
- alias resolution produces same tokens: `js` and `javascript` info strings tokenize identically
