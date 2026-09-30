# Feature: a tab in a list item's indentation

A tab in the indentation counts to the next multiple of four columns, as CommonMark reads it.

## Happy paths

- Loading `- a\n\n\tb\n`: one list whose item holds two paragraphs, `a` and `b`, not a list followed by indented code
- Loading `- a\n\n  \tb\n`: the same, not a paragraph and indented code inside the item

## User interactions

- Type one character after `a` in `- a\n\n  \tb\n`: the item keeps both paragraphs, the source reloads as the tree the editor holds, and the item's rewritten indentation is spaces (`- ax\n\n    b\n`)

## Miss-analysis

- GH #437: every body-membership pin indented with spaces, so a tab counted as no indentation and was never checked against CommonMark.
