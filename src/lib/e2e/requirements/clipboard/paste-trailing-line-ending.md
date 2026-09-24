# Clipboard: a one-line clipboard ending in a line ending

Copying one line usually brings its line ending along. Pasted at the end of a paragraph, that ending breaks nothing, so it is dropped rather than left as a blank line inside the paragraph.

## Happy paths

- `abc\n\nAfter\n`, caret at the end of `abc`, paste `x\n`: the source is `abcx\n\nAfter\n`, it reloads as the two paragraphs the editor holds, and a typed `Z` lands after `x`

## Edge cases

- The same paste in the middle of `abc` keeps the ending as a line break inside the paragraph: `ax\nbc`

## Miss-analysis

- GH #442: the inline paste pins used clipboards ending in content or in a whole blank line, so a single trailing line ending was never pasted; the paragraph kept it as a blank line only a reload turned into a block.
