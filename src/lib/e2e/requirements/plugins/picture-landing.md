# Feature: a range's landing beside a picture of its source

A table of contents and a `$$` block draw a picture of their source. A range taken whole beside one
lands off that source: in a `$$` block's body, or in the gap beside a table of contents, which has
no text of its own. A cut stops where its paste goes back, so before either it holds the gap.
Fixture: a divider and a paragraph through a heading's end, selected whole, in the `/test/plugins`
harness, both modes; the key, then `x`, then a click away (a `$$` body commits its source there).

## Happy paths

- Delete before a table of contents: `x` stands in its own paragraph above it
- A cut before a table of contents: the same
- Backspace with nothing above, before a table of contents: the same, as Delete lands
- Backspace after a table of contents: the gap below it gives way to the paragraph after, and `x`
  starts that paragraph's text
- Delete before a `$$` block: `x` starts its body
- A cut before a `$$` block: `x` stands in its own paragraph above it
- Backspace after a `$$` block: `x` ends its body; after a one-line `$$m$$`, its formula

## Miss-analysis

- Every landing row beside a block met kinds with text of their own, so none landed beside a
  picture, where Delete put the letter in front of `[[toc]]` and source mode's `$$` took it on its
  fence line.
