# Feature: A bullet typed into an unterminated last line

A document whose last paragraph has no final line break takes a typed `- ` at that paragraph's start like any other: it becomes one list item holding the text, and no dev check fires.

## Edge cases

- `para` with no final line break, caret at its start, `-`, space, `x`: one list item, `- xpara`, in source and live mode (regression #588: reported as the stale-raw check firing on this gesture; miss-analysis: no test typed a marker into a last line with no line break after it, so the one shape the parser treats as end of file was never written through the typing path)
- `a`, a blank line, then an unterminated `para`: the same keys make `a\n\n- xpara`, in source and live mode
- The same with CRLF line endings: `a\r\n\r\n- xpara`, in source and live mode
