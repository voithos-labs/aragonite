# Clipboard: Blockquote paste into a non-empty blockquote paragraph

The defect this guards: pasting a single blockquote clipboard while the caret sits in a non-empty blockquote paragraph classified that paragraph as an empty stub and spliced the clipboard over it, deleting the original text. A paragraph counts as empty only when it holds no text, so the paste lands beside the text and deletes nothing.

## Happy paths

- Caret at the end of a non-empty blockquote paragraph, paste a single-blockquote clipboard: the original paragraph text survives and the pasted text is present.

## Error cases

- The original blockquote text is never silently destroyed by the paste (regression guard for the destructive-replace path).
