# Clipboard: a one-line clipboard ending in a line ending

Copying one line usually brings its line ending along. The ending is part of what was copied, so it lands as Enter does where it lands.

## Happy paths

- `abc\n\nAfter\n`, caret at the end of `abc`, paste `x\n`: the source is `abcx\n\n\nAfter\n`, the caret on the empty line under `abcx`, it reloads as the blocks the editor holds, and a typed `Z` lands on that line: `abcx\n\nZ\n\nAfter\n`

## Edge cases

- The same paste in the middle of `abc` keeps the ending as a line break inside the paragraph: `ax\nbc`
- At the end of a file with no last line break the ending is Enter there, and the empty line it opens keeps its break: `abc` gives `abcx\n\n\n` (a typed `Z`: `abcx\n\nZ\n`), `- abc` gives `- abcx\n- \n`, `> abc` gives `> abcx\n>\n>\n`, each with no dev warning

## Miss-analysis

- An open last line: every ending row's document ended in a line break, so the paste that gained the file a last line break on a written line (the last-line check fired) and left an open quote's caret in its text went unpinned.
- GH #442: the inline paste pins used clipboards ending in content or in a whole blank line, so a single trailing line ending was never pasted; the paragraph kept it as a blank line only a reload turned into a block.
