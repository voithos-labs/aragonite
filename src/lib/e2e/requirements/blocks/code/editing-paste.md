# Feature: Code Block Paste

Paste into a code block: fence-length bumping and literal absorption of multi-block markdown.

## Paste

- paste containing triple backticks into a backtick-fenced code block bumps the outer fence to 4+ backticks, preserving the pasted content as literal body
- paste of multi-block markdown into a code block stays literal (no block splitting, no kind change)
