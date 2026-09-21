# Feature: Code Block, Auto-Indent on Enter

Enter inside a fenced code block copies the current line's leading whitespace onto the new line.

## Auto-indent on Enter

- Enter at the end of an indented line begins the next line with the same leading whitespace
- The indent keeps tabs and spaces verbatim, with no normalization
- Enter at the end of a line with no indent behaves as it always has (a bare newline)
- Enter in the middle of an indented line leaves the prefix on the original line and starts the remainder on a new indented line
- Enter on a blank line with a leading indent keeps the indent on the next line
- Auto-indent does not change the exit-on-double-Enter path for closed fences
