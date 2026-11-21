# Feature: A line break over a range writes where text would

Enter, Shift+Enter and a soft keyboard's two breaks over a range go where text typed over it goes: before the rest of the text the range ended in, else on a line it emptied, else in an empty paragraph opened where the range was. No break writes in a block the range did not reach. Each row presses the key, then types `x`, in source and live mode.

Miss-analysis: the break rows ran in jsdom only and pinned the break at the end of the block before, so Chromium never checked that a break stays out of a block the range did not reach.

## Happy paths

- Shift+Enter over a divider and a heading held whole, a paragraph before them: the break and the letter stand in an empty paragraph where they were (`first\n\n\\\nx`), as 0.11.5 left them; never `first\` and the letter on its next line.
- Enter over the same blocks under a fence: an empty paragraph where they were takes the letter (0.11.5 left one empty line more); no line goes into the code.
- Shift+Enter over the same blocks under a fence: the break stands in that paragraph, as 0.11.5 left it.

## Edge cases

- Shift+Enter over a quote's last blocks, the quote tight: the break stays inside the quote, on a line of its own under the paragraph above (`> above\n>\n> \\\n> x`), as 0.11.5 left it.
- Shift+Enter over a divider held whole between two paragraphs: the break stands in an empty paragraph where the divider was; 0.11.5 wrote it at the end of the paragraph above.
