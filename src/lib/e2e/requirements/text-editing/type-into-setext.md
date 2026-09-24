# Feature: typing into a setext heading

A setext heading keeps its structure in the underline below its title (`===` or `---`). No
presentation mode draws that line, so the block's text on screen stops at the title, and every
write that starts from what the screen holds has to put the underline back. Typing one character
must change one character, and nothing else in the file.

Miss-analysis: the setext specs covered Enter and the merges and none typed into the heading, the
unit suites had typing tests for cells and code blocks but not for prose blocks, and the shape
property's retype writes the stored bytes back, so it checks the underline helper and never the
text the block reads from the screen.

## Happy paths

- End then a character, in source and live mode, under a `---`, a `===` and a ten-dash underline: the character joins the title and the underline stays, byte for byte; the block is still a setext heading
- Home then a character, in both modes: the character lands before the title and the underline stays

## Edge cases

- a heading in the middle of a document: the blocks around it and the blank lines between keep their bytes
- a CRLF document: the title line and the underline keep their CRLF endings
- a heading inside a list item (`- Plan` over an indented `---`) and inside a quote (`> Plan` over `> ===`): the underline keeps its container prefix
- one undo after typing puts the title back and leaves the underline where it was

## User interactions

- a real click then End or Home then a typed key: the caret and the input go through the browser, not a placed selection
- a paste at the title end: the pasted text joins the title and the underline stays (this route already kept it; pinned beside the others)
- an IME composition committed at the title end: the composed text joins the title and the underline stays

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
