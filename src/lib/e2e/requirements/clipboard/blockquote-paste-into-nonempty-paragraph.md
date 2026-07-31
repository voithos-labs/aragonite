# Clipboard: Blockquote paste into a non-empty blockquote paragraph

The defect this guards: pasting a single blockquote clipboard while the caret sits in a non-empty blockquote paragraph classified that paragraph as an empty stub and spliced the clipboard over it, deleting the original text. The fix makes a childless leaf count as empty only when its own raw is blank, so the paste defers to default structural paste with no data loss.

## Happy paths

- Caret at the end of a non-empty blockquote paragraph, paste a single-blockquote clipboard: the original paragraph text survives and the pasted text is present.

## Error cases

- The original blockquote text is never silently destroyed by the paste (regression guard for the destructive-replace path).
