# Feature: a picture sits in its line

A picture lays out inline in its paragraph, the way Markdown means it: a letter typed beside it lands on the picture's own line, and the browser holds a caret there that an input method can compose at. A picture alone in its paragraph still takes its own line, with no gap under it. A picture that ends its paragraph leaves a caret anchor after it (a `<br>` holding no text) so the line has a text-height box for the caret's bar to stand at; the anchor is never content.

## Happy paths

- A letter typed after a lone picture (Backspace from the empty paragraph below, or a click past it) lands on the picture's line, at its right edge
- A letter typed before a lone picture lands on the picture's line, at its left edge
- The same in a list item and in a quote
- A picture alone in its paragraph leaves no gap under it, a linked one too: the paragraph is the picture's box and margins tall
  - Miss-analysis: every image row read the picture's own box, never the paragraph around it, so the linked picture's baseline gap never showed

## User interactions

- After a click past a picture, or Backspace from the paragraph below, the browser holds a collapsed caret in the picture's paragraph, in text or right before the caret anchor
- An input method composing after a lone picture (Backspace from below, or a click past it) or before one starts its composition, and the composed text lands there
  - Miss-analysis: no composition row ever ran beside a picture, and the picture laid out as a block, where Chromium starts no composition at all

## Edge cases

- A lone picture's paragraph shows no empty-block hint: the anchor isn't content
- Backspace at a lone picture's start joins it to the paragraph above, and Delete at its end joins the paragraph below to it, as for any paragraph with content
- The paragraph's aria snapshot holds the picture and nothing for the anchor (Chromium's full tree still gives the anchor a line break node, which the snapshot leaves out)
