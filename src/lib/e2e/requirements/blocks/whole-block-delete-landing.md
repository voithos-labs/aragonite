# Feature: Where the caret goes after a whole-block delete

A block the editor focuses as a whole (a rule, an image, a diagram) goes in one key. Once it's
gone the caret moves to the side the key points: Backspace points back, Delete and cut point
forward. With nothing on that side it takes the other one. Fixture: `a`, a `---` rule, `b`,
with the rule focused by ArrowDown from the end of `a`.

## Happy paths

- Backspace on the rule deletes it, and typed text lands at the end of `a`
- Delete on the rule deletes it, and typed text lands at the start of `b`
- Ctrl+X on the rule cuts it, and typed text lands at the start of `b`

## The only block

- A rule that's the whole document, focused by a click, goes on Backspace, Delete or Ctrl+X, and
  leaves an empty paragraph holding the caret: a typed `x` gives `x\n`
  - Miss-analysis: every whole-block delete row kept a block beside the rule, so the empty
    document it left had never been looked at.

## Miss-analysis

- Every whole-block delete landed at the next block's start whatever the key, since the delete
  never asked which way the key pointed. The whole-block tests checked the bytes after the
  delete and never typed into the caret it left.
