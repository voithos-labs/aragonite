# Feature: Code Block Highlighting

Syntax-highlight rendering for code blocks: tokenization spans for known languages, info-string styling, unknown-language fallthrough, and alias resolution.

## Highlighting

- tokenization renders spans for known languages: a `js` code block containing `const x = 42;` has at least one `.code-tok-keyword` span
- info string rendered with .md-lang class: opener line's language name has `.md-lang` class for distinct styling
- unknown language falls through to plain text: a `klingon` info string produces no `.code-tok-*` spans in the body
- alias resolution produces same tokens: `js` and `javascript` info strings tokenize identically
