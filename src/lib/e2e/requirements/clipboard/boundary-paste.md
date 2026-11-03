# Feature: a paste at a boundary

The gap caret (the caret parked between two blocks) and a block focused whole (a rule, a diagram)
have no text to paste into, so a paste there inserts the clipboard's Markdown as blocks at that
spot, through the same route `insertMarkdown` takes.

Miss-analysis: both surfaces declined a paste by design, and no spec pasted at either, so Ctrl+V
there did nothing at all.

## Happy paths

- a paste at the gap above a code block: the clipboard's heading and paragraph land at the gap,
  above the code block, and one undo takes both back
- a paste on a rule focused whole: the clipboard's paragraph lands after the rule

## Edge cases

- a paste on a rule focused whole in a CRLF document: the pasted lines and the blank line after
  them keep the document's CRLF

## User interactions

- the gap comes from a click in the code block, the block-start key and ArrowLeft; the rule takes
  focus from the paragraph above by ArrowDown; the paste is Ctrl/Cmd+V over a seeded clipboard
