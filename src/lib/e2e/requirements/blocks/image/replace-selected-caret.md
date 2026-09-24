# Feature: the caret after text replaces a selected image

An image selected whole is replaced by whatever lands on it: a typed key, a paste, or `insertMarkdown`. Each route leaves a caret right after the text that replaced it, so the next key continues there.

## User interactions

- Click the image in `abc ![c|60x40](img) tail`, type `XY`: the source reads `abc XY tail`, and `getSelection()` reports a caret after `Y`
- Click the image, press Backspace, type `Z`: the `Z` lands where the image stood
- Click the image, call `insertMarkdown('text')`: the source reads `abc text tail`, `getSelection()` reports a caret after `text` once the call resolves, and a typed `Z` lands there
- Click the image, paste `text` with Ctrl+V: the source reads `abc text tail`, and a typed `Z` lands after `text`

## Miss-analysis

- GH #440: every spec replacing a selected image asserted the bytes of one write, so none read the caret after the image was gone or typed after an insert; the widget splice wrote the text and set no caret, and the browser's fallback sat at the paragraph start.
- GH #441: no spec typed two characters over a selected image, so the second key landing at that fallback caret was never seen.
