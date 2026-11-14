# Clipboard: Nested Structural Paste, Ref Alignment via Registry

Regression coverage for the 0.5.1 rewrite that routed `handlePaste`'s nested structural branch (the path taken when the collapsed caret after cross-block delete has `path.length >= 2` and the clipboard is not a single-paragraph inline paste) through the `BlockListState` registry. Pins that the last-inserted block gets ref-based focus after paste, eliminating the deleted `focusLastInsertedBlock` DOM-focus helper.

## Happy paths

- Cross-block selection across two inner paragraphs of a blockquote, paste of multi-block markdown (3 paragraphs): pasted blocks land as inner children of the blockquote, the surviving tail paragraph is preserved, one blank quote line parts the pasted blocks from the tail (the two emptied paragraphs leave one empty line between the blank lines around them, `structural-edits.md` § Structural operations, so the paste over the range leaves what a cut and then the same paste leave), and the clipboard's last line ending leaves the caret held on the line under the last pasted block, inside the quote (verified by typing a marker, which opens a paragraph of its own between the last pasted paragraph and the tail)

## User interactions

- Shift-click cross-block inside a blockquote → Ctrl+V multi-block markdown ending in a line ending → type a marker: the marker lands in the quote under the last pasted block, not in the tail paragraph and not outside the quote
