# Feature: Code block partial copy — fence boundary stripping

A fenced code block stores its opener, body, and closer as one flat string.
A native single-block selection that includes the fence lines would otherwise
put orphan fence markers on the clipboard. The copy path strips fence-only
lines from the leading and trailing edges of a partial selection so the
clipboard never holds a lone `` ``` ``.

## Happy paths
- Ctrl+A selects the entire code block display and copy preserves the full fence pair on the clipboard (round-trippable as a complete code block).
- A partial selection that includes the opening fence and some body lines copies only the body lines — the opening fence is stripped.
- A partial selection that includes body lines and the closing fence copies only the body lines — the closing fence is stripped.

## Edge cases
- When the selection starts with the opener fence (lines 1..n), the leading fence line is dropped so the clipboard has zero or paired fences.
- When the selection ends with the closer fence (lines n..last), the trailing fence line is dropped so the clipboard has zero or paired fences.
- Pasting the partial copy into a paragraph elsewhere does not introduce an orphan ``` that would break markdown re-parsing of the destination document.

## User interactions
- Triple-click / Ctrl+A inside a code block then Ctrl+C: full block including fences on the clipboard.
- Click in the body, Shift+Arrow across a fence boundary, Ctrl+C: fence is stripped from the boundary of the clipboard text.
