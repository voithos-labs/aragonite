# Clipboard: a paste into a CRLF document writes CRLF

Every paste entry point hands the clipboard on as LF, which is what the paste rules and a
plugin's paste transforms read. The document keeps its own line ending, so the lines a paste
writes into it take the ending of the line the caret is on. Driven on `/test/editor` with the
system clipboard and a real `Mod+V`; the source is compared with its line endings spelled out, so
a lone CR shows in the diff.

## Happy paths

- `abc\r\nAfter\r\n`, caret at the end of `abc`, paste `x\n\ny`: the source is
  `abcx\r\n\r\ny\r\nAfter\r\n` (the first paragraph joins `abc`, the last the line after it), with
  no LF-only line anywhere, and a reload reads the same blocks
- the same caret, paste `x\ny`: the one paragraph takes both lines, `abcx\r\ny\r\nAfter\r\n`

## Miss-analysis

- GH #448: every clipboard spec normalized the source to LF before comparing, so a document
  holding both endings read the same as one holding only LF; the unit mirror check compared only
  the separators a paste created and left the pasted lines out on purpose.
- GH #744: in WebKit and Firefox the caret after End sat between the CR and the LF, so the paste
  split the pair; the comparison printed the CR invisibly, and only Chromium gated.
