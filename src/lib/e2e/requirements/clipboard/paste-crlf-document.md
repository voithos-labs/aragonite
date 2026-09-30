# Clipboard: a paste into a CRLF document writes CRLF

Every paste entry point hands the clipboard on as LF, which is what the paste rules and a
plugin's paste transforms read. The document keeps its own line ending, so the lines a paste
writes into it take the ending of the line the caret is on. Driven on `/test/editor` with the
system clipboard and a real `Mod+V`; the source is compared byte for byte, CR included.

## Happy paths

- `abc\r\nAfter\r\n`, caret at the end of `abc`, paste `x\n\ny`: the source is
  `abc\r\n\r\nx\r\n\r\ny\r\nAfter\r\n`, with no LF-only line anywhere, and a reload reads the same
  blocks
- the same caret, paste `x\ny`: the one paragraph takes both lines, `abcx\r\ny\r\nAfter\r\n`

## Miss-analysis

- GH #448: every clipboard spec normalized the source to LF before comparing, so a document
  holding both endings read the same as one holding only LF; the unit mirror check compared only
  the separators a paste created and left the pasted lines out on purpose.
