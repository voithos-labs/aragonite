# Feature: A last line with no line break

A file whose last line has no line ending keeps it that way through a structural edit: a block added after that line gets a line of its own, and the file still ends with no break unless its new last line is blank. Typing into the new block may add its own ending, which is a separate rule, so the typed rows below check the text before any final break.

## Happy paths

- `- a`, `- b` with no final break, caret in `b`, End, Enter, `c`: three items, `- a\n- b\n- c`, in source and live mode (the empty item Enter makes keeps its break, `- \n`, like any empty last block) (regression #635; miss-analysis: every list-end Enter test ended its fixture in a line break, so the item the Enter added was never written after a line that had none)
- `one` with no final break, caret in it, End, ArrowDown, `x`: two paragraphs, `one\n\nx`, in source and live mode (regression #635; same miss: the ArrowDown append was only ever run after a closed last line)
- `one` with no final break, a click on the row just below it, `x`: two paragraphs, `one\n\nx`, in source and live mode (regression #635; same miss: the trailing insert row had no test on a file without a final break)

## Edge cases

- `a`, a blank line, `# b` with no final break, caret in the heading, Alt+ArrowUp: `# b\n\na`, still with no final break, in source and live mode
