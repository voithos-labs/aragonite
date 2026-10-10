# Feature: the drawn caret beside a text-height widget

Beside a non-editable widget the editor draws its own caret (`requirements/blocks/image/caret-synthetic-indicator.md`).
Beside a widget the height of a character, an emoji or a decoded entity, that caret stands where
the browser's own caret would, so it has the same height and the same top as the browser's caret
at any prose offset of the same paragraph. It's 1.5px wide, its right side 1px past the widget's.

## Happy paths

- click past the end of a line that ends in an emoji: the drawn caret beside it is the native
  caret's height, within 15 percent, at the native caret's top
  - Miss-analysis: every indicator test read the paint's position and width, never its height,
    so a caret inset from the widget's box to about half the line's height passed them all
- the same beside a decoded entity ending the line: the rule is the kind-agnostic one for a
  text-height widget, not the emoji's
- click left of an emoji that starts the line: the drawn caret stands before it, its left side 1px
  past the emoji's, at the emoji's full height
  - Miss-analysis: every parity row clicked past a widget's end, so the side a click before a
    widget lands on was never measured against the old caret
