# Clipboard: a one-line clipboard ending in a line ending

Copying one line usually brings its line ending along. The ending is part of what was copied, so it lands as Enter does where it lands.

## Happy paths

- `abc\n\nAfter\n`, caret at the end of `abc`, paste `x\n`: the source is `abcx\n\n\nAfter\n`, the caret on the empty line under `abcx`, it reloads as the blocks the editor holds, and a typed `Z` lands on that line: `abcx\n\nZ\n\nAfter\n`

## Edge cases

- The same paste in the middle of `abc` keeps the ending as a line break inside the paragraph: `ax\nbc`

## Miss-analysis

- GH #442: the inline paste pins used clipboards ending in content or in a whole blank line, so a single trailing line ending was never pasted; the paragraph kept it as a blank line only a reload turned into a block.
