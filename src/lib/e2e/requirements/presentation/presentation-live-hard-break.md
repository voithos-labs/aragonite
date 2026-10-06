# Presentation: the hidden hard break

A hard break is a backslash or two-plus trailing spaces before a newline, and it keeps the next
line inside the same paragraph. Wherever markers are hidden, that's all it is on screen: a line
break, nothing drawn in place of the hidden bytes. Same as every other editor that doesn't show
you its markup. Source mode is the exception for the trailing-space form, whose bytes are blank
there too, so it draws a dimmed return glyph after them. The glyph is stylesheet content, not
text, so the caret, a selection and a copy see only the break's own bytes.

Miss-analysis: the hard-break specs checked what the break writes and deletes, never what a
rendered view leaves of it, which for trailing spaces was nothing in every mode.

## Happy paths

- `one  \ntwo` pasted into live mode draws no glyph, and the block's text is still the bytes.
- Live and preview-block (an unfocused block, markers hidden) draw no glyph for the backslash
  form or the trailing-space form.
- The empty line Shift+Enter opens at a block's end draws no glyph, in live mode and in source
  mode: it's an empty line with the caret on it.

## Edge cases

- Source mode draws the glyph for the trailing-space break, and not beside a backslash, which
  source mode already shows.

## User interactions

- From the start of `two`, one ArrowLeft lands the caret at the end of `one` and one ArrowRight
  brings it back: the hidden break is one step.
- Backspace at the start of `two` removes the break, leaving `onetwo`.
