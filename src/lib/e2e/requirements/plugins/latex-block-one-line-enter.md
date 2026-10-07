# Feature: Enter in a one-line math block

A `$$` block comes in two forms. The one-line form keeps everything on one line (`$$x^2$$`), and
the multi-line form puts each `$$` on a line of its own with the formula between. Press Enter in
the one-line form's source and it turns into the multi-line form, with the new line inside the
formula: on screen right away, and in the file once you click out. It's the same thing Enter
already does in the multi-line form.

Fixture: `Before` / `$$x^2$$` / `After` (`?seed=mathblock`).

## Happy paths

- Enter at the end of the formula in live mode, then `y`: the source reads `$$\nx^2\ny\n$$`, and
  clicking out writes `Before\n\n$$\nx^2\ny\n$$\n\nAfter\n`, one math block that a reload reads
  the same way
- the same in source mode, where the closing `$$` is painted, so the caret walks back past it
  before Enter

## Edge cases

- empty the paragraph under the block, Backspace there (which keeps the paragraph and puts the
  caret at the end of the formula, since a math block can't merge), then Enter and `y`: still one
  well-formed math block, and the empty paragraph stays

## User interactions

- one undo after the click out puts the one-line `$$x^2$$` back, whole

## Miss-analysis

- Every Enter row opened a multi-line source, so nothing pressed Enter in the one-line form, where
  the screen, the bytes and a reload each read the result differently: the painter stopped
  recognising the `$$`, and the write gave line 0 a second closer and left the old one as a stray
  `$$` paragraph that could swallow the document below on reload.
