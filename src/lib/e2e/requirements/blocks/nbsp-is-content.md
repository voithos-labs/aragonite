# Feature: A non-breaking space is content

A block is empty when it holds nothing but spaces, tabs and line breaks, the way GFM reads a blank line. A non-breaking space is a character, so a block holding one isn't empty, and the rules that only fire on an empty block leave it alone.

## Edge cases

- Enter at the end of a quote's last paragraph, which holds only a non-breaking space, splits inside the quote. The quote stays one block and the non-breaking space stays in the source.
  - Miss-analysis: every exit test left the quote from a paragraph with nothing in it, so none saw `String.trim()` count a pasted non-breaking space as nothing and drop it.
- Enter at the end of a list item holding only a non-breaking space starts a new item below it. The list keeps the item and its non-breaking space.
  - Miss-analysis: the exit-list tests typed their empty items with Enter, which writes no character at all, so the one-character item that `trim()` read as empty never came up.
