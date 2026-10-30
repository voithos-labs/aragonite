# Feature: Caret dispatch around image+text paragraphs

A paragraph that starts image-only is vertically transparent. Once the user types trailing text, the paragraph stops being transparent and the editor must send caret traversal to the part that now holds text. Ordinary typing must refresh the paragraph's inline parse; otherwise a stale parse leaves the editor still treating the paragraph as image-only.

## Happy paths

- After typing trailing text into an image-only paragraph, ArrowUp from the next paragraph lands in that paragraph's trailing text, never inside "text1" above it
- After typing trailing text, cross-block ArrowLeft into the image+text paragraph lands the caret after the typed text rather than selecting the widget
- Down from the start of the paragraph above (a column left of the image) lands a visible caret in the typed text beside the image, never on an element-level position beside the widget that nothing renders
- Pressing Down twice from the line above the image+text paragraph reaches the line below it: an inline image inside a text-bearing paragraph is not a vertical stop, because the paragraph carries a column; only a widget-only block is entered as an object by a vertical arrival
