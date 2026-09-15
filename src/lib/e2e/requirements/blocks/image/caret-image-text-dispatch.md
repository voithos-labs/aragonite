# Feature: Caret dispatch around image+text paragraphs

A paragraph that starts image-only is vertically transparent. Once the user types trailing text, the paragraph stops being transparent and the editor must dispatch caret traversal to the now-text-bearing portion. Routine typing must refresh the paragraph's inline parse; otherwise stale parses make the editor still treat the paragraph as image-only.

## Happy paths

- After typing trailing text into an image-only paragraph, ArrowUp from the next paragraph lands at the end of the (now image+text) paragraph, never inside "text1" above it
- After typing trailing text, cross-block ArrowLeft into the image+text paragraph lands the caret after the typed text rather than selecting the widget
- Within an image+text paragraph, the image's visual line is vertically transparent — sticky-Down from the paragraph above lands a visible caret on the text-bearing line, never on an unrenderable element-level position next to the widget
- Pressing Down twice from the line above the image+text paragraph reaches the line below it (image visual line is skipped on each press); an inline image inside a text-bearing paragraph is not a vertical stop, because the paragraph carries a column; only a widget-only block is entered as an object by a vertical arrival
