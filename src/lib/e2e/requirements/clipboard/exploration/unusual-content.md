# Clipboard Exploration: Unusual Content

Paste with non-standard clipboard content shapes: CRLF line endings, leading blank lines, content pasted into non-editable blocks, fence-bump through paste, and whole-document replacement via Ctrl+A+A + Ctrl+V.

## Happy paths

- CRLF-separated paragraphs paste as multi-block content.
- Leading blank lines in the clipboard arrive as the blocks they were copied as: pasting `"\n\nactual content\n"` at the end of `target` separates the run from `target` and keeps both blank lines, over four DOM blocks whose bytes reload as the same four.
- Paste while focused on a thematic break doesn't corrupt the document (either no-op or creates a paragraph).
- Pasting backtick runs into a code block bumps the outer fence to preserve literal content.
- Whole-document replacement via Ctrl+A+A + Ctrl+V replaces the entire document.
