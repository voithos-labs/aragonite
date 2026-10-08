# The drawn caret at a soft wrap

At the offset where a line wraps, the range reads as the first line's end, whichever line the
browser draws its caret on, so there the drawn caret steps aside and the browser's own caret shows.
Each row shows exactly one caret, and a drawn one is compared once against the browser's own
painted caret (a red caret, found in a screenshot), by line and by x.

## Happy paths

- End on a wrapped line: the browser's own caret, at the wrap
- Home on the second visual line: the browser's own caret, at the wrap
- ArrowRight across a wrap: the drawn caret, on the browser's line
- Typing at a wrap: one caret, on the browser's line

## Edge cases

- Home on a visual line that starts with a formatted word (a bold word, a code span, a link), in
  source and live mode: the browser's own caret, at the wrap. The spaces the line wraps in end one
  text node and the word starts another, so the check reads the letters on both sides across nodes
  - Miss-analysis: every soft-wrap row wrapped plain words in one text node, so nothing put a
    node boundary at the wrap, and the check that only read the caret's own node passed them all
