# The drawn caret's look

The drawn caret shows what the next letter you type will look like: a heavier bar for bold, a bar slanted from its foot for italic, and a small tick across it for strikethrough. They stack, so bold italic is a slanted heavy bar. Inside inline code it stays the plain bar.

In live mode the markers are hidden, so the shape is how you know what you'll get. A letter takes the format of the character before it, like in a word processor: after `bold` in `a **bold** b` it types bold, and one ArrowRight later it types plain. So every scenario below reads the shape, then types a letter and checks the bytes agree with it.

The rows run in live mode on bold, italic and strikethrough, mid-line and at a line's end, in a paragraph and in a table cell.

## Happy paths

- The caret at a construct's inside end shows the construct's shape, and the next letter types inside it
- One ArrowRight there moves the caret one character, like any arrow press, and the shape follows the character before it: plain after the space, and the letter types there
- ArrowLeft back from the text after a construct to its end shows the construct's shape again, and the letter types inside
- End on a line that ends in the construct keeps the construct's shape, and the next letter types inside
- Typing the closer at the inside end shows the plain bar, the next letter types outside, and no delimiter ends up doubled
- The format chord at the inside end shows the plain bar before any letter is typed, and the next letter types outside
- Ctrl+B at a plain caret shows the bold shape before any letter, and the letter types bold; a second Ctrl+B shows the plain bar again, and the letter types plain

## Edge cases

- A space typed at a hidden closer is written past it, the caret keeps the construct's shape after the space, and the next letter types inside
  - Miss-analysis: nothing on screen said which side a held space meant, so no row could read it, and a space held at a strikethrough closer looked like it had left the strikethrough
- After that space, ArrowRight, End, the whole closer and the format chord each show the plain bar, and the next letter types outside, right after the space

## What draws

Each shape is read off the bar's computed style, in the light theme and the dark one, since the attribute on the bar proves nothing if no rule draws it.

- Plain: a 1px bar
- Bold: a 3px bar
- Italic: the bar's transform slants it
- Strikethrough: a tick 13px wide and 2px tall across the bar, at 55% of its height
- Bold italic: a 3px bar, slanted
- Inline code: the plain 1px bar
- Every shape keeps the bar's foot, top and height where the browser's own caret stands, and the bar keeps a visible color
