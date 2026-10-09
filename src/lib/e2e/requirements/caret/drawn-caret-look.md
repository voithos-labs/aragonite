# The drawn caret's look

The drawn caret shows what the next letter you type will look like: a heavier bar for bold, a bar slanted from its foot for italic, and a small tick across it for strikethrough. They stack, so bold italic is a slanted heavy bar. Inside inline code it stays the plain bar.

In live mode this is how you tell inside from outside. Both sides of a hidden closer sit on the same pixel, so after `bold` in `a **bold** b` the caret can mean "type bold" or "type plain" without moving. Its shape says which, and so does the faint ring on the construct. So every scenario below reads the shape, then types a letter and checks the bytes agree with it.

The rows run in live mode on bold, italic and strikethrough, mid-line and at a line's end, in a paragraph and in a table cell.

## Happy paths

- The caret at a construct's inside end shows the construct's shape, and the next letter types inside it
- One ArrowRight there keeps the caret's x, turns the shape plain on that same press, and the next letter types outside
- End on a line that ends in the construct shows the plain bar, and the next letter types outside
- Typing the closer at the inside end shows the plain bar, the next letter types outside, and no delimiter ends up doubled
- The format chord at the inside end shows the plain bar before any letter is typed, and the next letter types outside
- Ctrl+B at a plain caret shows the bold shape before any letter, and the letter types bold; a second Ctrl+B shows the plain bar again, and the letter types plain

## Edge cases

- A space typed at a hidden closer is written past it, the caret keeps the construct's shape after the space, and the next letter types inside
  - Miss-analysis: nothing on screen said which side a held space meant, so no row could read it, and a space held at a strikethrough closer looked like it had left the strikethrough
- After that space, ArrowRight, End, the closer's first byte (the whole closer writes a stray byte today) and the format chord each show the plain bar, and the next letter types outside

## What draws

Each shape is read off the bar's computed style, in the light theme and the dark one, since the attribute on the bar proves nothing if no rule draws it.

- Plain: a 1px bar
- Bold: a 3px bar
- Italic: the bar's transform slants it
- Strikethrough: a tick 7px wide and 1px tall across the bar, at 55% of its height
- Bold italic: a 3px bar, slanted
- Inline code: the plain 1px bar
- Every shape keeps the bar's foot, top and height where the browser's own caret stands, and the bar keeps a visible color
