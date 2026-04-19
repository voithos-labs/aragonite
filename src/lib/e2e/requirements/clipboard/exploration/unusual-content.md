# Clipboard Exploration: Unusual Content

Paste with non-standard clipboard content shapes: CRLF line endings, leading blank lines, content pasted into non-editable blocks, fence-bump through paste, and whole-document replacement via Ctrl+A+A + Ctrl+V.

## Happy paths

- CRLF-separated paragraphs paste as multi-block content.
- Leading blank lines in clipboard don't create spurious empty paragraphs.
- Paste while focused on a thematic break doesn't corrupt the document (either no-op or creates a paragraph).
- Pasting backtick runs into a code block bumps the outer fence to preserve literal content.
- Whole-document replacement via Ctrl+A+A + Ctrl+V replaces the entire document.
