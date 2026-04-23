# Feature: Code Block Tab / Indent

Tab and Shift+Tab behavior inside a code block: literal-tab insertion, single-line dedent of tabs or up-to-4 leading spaces, and multi-line selection indent/dedent.

## Tab / indent

- Tab with no selection inserts a literal `\t` at the cursor
- Tab with a multi-line selection indents every line the selection touches by one tab
- Shift+Tab with no selection removes a leading `\t` from the current line
- Shift+Tab with no selection removes up to 4 leading spaces from the current line
- Shift+Tab is a no-op on a line with no leading whitespace
- Shift+Tab with a multi-line selection dedents every line the selection touches; lines with no leading whitespace are skipped silently
