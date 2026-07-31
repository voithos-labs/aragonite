# Clipboard: Silent Drop — Multi-Item List Paste Over Multi-Item List Selection

The defect this guards: copying a multi-item list and pasting into a cross-block selection across multiple items of another list silently deletes the selection and inserts nothing. Second Ctrl+V after the no-op does paste the clipboard content.

## Happy paths

- Multi-item list on clipboard, cross-block selection spans 2+ items in another list, Ctrl+V: pasted items replace the selection; caret lands at the end of the last pasted content.

## Edge cases

- Content outside the selection range survives intact at both endpoints.
