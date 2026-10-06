# Presentation: Shift+Enter at the end of a block

Shift+Enter at the end of a block opens an empty line under the text, with the caret on it and a
dimmed return glyph after the text, in every mode that edits. Nothing is written yet. A hard break
in Markdown is a backslash at the end of a line, and a backslash with no next line is just a
backslash, so the break's bytes go in with the first thing that lands on the new line, whichever
way it arrives. Anything else (a click elsewhere, a caret key, the block losing focus) drops the
line and leaves the bytes alone.

Miss-analysis: the break used to be written straight away as a trailing backslash and read back
from the bytes, and every test typed a letter after it through the key route. So nobody saw that a
backslash typed by hand reads as a break (#522), that punctuation, a paste or an IME commit wrote
an escape instead, or that a second Shift+Enter escaped the first one and sent the caret back up
(#614).

## Happy paths

- `abc def`, End, Shift+Enter twice, then `x`: nothing is written until the `x`, which lands on the
  third line, `abc def\` / `\` / `x`. Source and live mode.
- Shift+Enter at the end, then `-`: `abc\` / `-`. Punctuation is not an escape here. Source and
  live mode.
- Shift+Enter at the end, then Ctrl+V of `x`: `abc\` / `x`. Source and live mode.
- Shift+Enter at the end, then an IME commit of `か`: `abc\` / `か`. Source and live mode.

## Edge cases

- `see C:`, End, type `\` then `U`: `see C:\U`. A typed backslash is a backslash. Source and live
  mode.
- live, `a **bold**`, Shift+Enter at the end, then ArrowLeft: the new line goes before the edge
  step can take the key, and the next key writes no backslash.
- live, `a **bold** b`, caret at the end of `bold`, ArrowRight (the edge step out of the bold),
  then Ctrl+V of `X`: `a **bold**X b`. The paste lands on the side the step chose.
- live, `abc def`, Shift+Enter at the end, `x`, Backspace: the line is emptied. The next Backspace
  deletes something rather than being swallowed (#690).

## User interactions

- Shift+Enter at the end, then a click in another block: the source is unchanged and the first
  block draws no extra line. Source and live mode.
