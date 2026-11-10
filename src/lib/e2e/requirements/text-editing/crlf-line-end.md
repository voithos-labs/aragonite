# Text editing: a CRLF line end edits as one character

In a CRLF document, the `\r\n` that ends a line inside a paragraph or a code body edits as one
character, the way Chromium edits it. WebKit and Firefox let the caret stop between the `\r` and
the `\n`, and delete one of the two on its own; the editor reads that caret as the line's end and
keeps the pair whole, so no edit leaves a lone `\r` or `\n`. Each row runs in source and live mode,
and the source is compared with its line endings spelled out.

## Happy paths

- `abc\r\nAfter\r\n`, caret at the start, End, type `Z`: `abcZ\r\nAfter\r\n`
- the same text, a click past the end of `abc`, type `Z`: `abcZ\r\nAfter\r\n`
- a code block with the body `abc\r\nxyz`, caret in the first body line, End, type `Z`: the body
  reads `abcZ\r\nxyz`

## Edge cases

- `abc\r\nAfter\r\n`, caret at the start, Shift+End, type `Z`: `Z\r\nAfter\r\n`, the pair kept
- deleting at a CRLF line end is the editor's own delete; its rows are in
  `collapsed-delete-class.md`
- `abc\r\nAfter\r\n`, a commit writes `abX` and names its caret between the `\r` and the `\n`: the
  caret lands before the pair (no `caret-in-line-ending-pair` warning), and `Z` gives
  `abXZ\r\nAfter\r\n`

## Miss-analysis

- GH #744: every typing and deletion spec ran in Chromium, which never stops a caret inside a CRLF
  pair or deletes half of one, and no other engine gated, so the engine census was the first run
  to type at a CRLF line end in WebKit or Firefox.
- A commit's caret named between a pair: every landing row used LF bytes, so none named a caret
  inside a pair.
