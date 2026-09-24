# Feature: indenting a paragraph under a loose list item

A paragraph after a blank line under a list joins the item above once its first line is indented to the item's content, which is how a reload reads it; the editor holds it there as soon as the indent is typed.

## Happy paths

- Two spaces typed at the start of `zz` in `- a\n\nzz\n`: the paragraph is the item's second paragraph, and the source reloads as the tree the editor holds (regression: the editor kept `zz` as a block of its own; miss-analysis: a write that keeps its block's kind skipped the neighbour merge for typing cost, and no join case indented a paragraph by less than the four spaces that turn it into code)
- The same two spaces pasted: the same join
- A pasted tab: the same join (a tab reads as code on its own, so this one always joined)
- Three spaces under `1. a`: the join, at the ordered item's wider content
- Four spaces under a nested item: the paragraph joins the inner item
- Two spaces under the outer of two nested items: the paragraph joins the outer item

## Edge cases

- Two spaces under `1. a`, one short of its content: the paragraph stays its own
- A space removed from a paragraph short of the item: it stays its own, and reloads the same
- Backspace at the start of the joined paragraph: it joins the item's text (`- azz`), and reloads the same
- The key typed after the indent lands before the text, inside the item
