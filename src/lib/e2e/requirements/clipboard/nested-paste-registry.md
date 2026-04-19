# Clipboard: Nested Structural Paste — Ref Alignment via Registry

Regression coverage for the 0.5.1 rewrite that routed `handlePaste`'s nested structural branch (the path taken when the collapsed caret after cross-block delete has `path.length >= 2` and the clipboard is not a single-paragraph inline paste) through the `BlockListState` registry. Pins that the last-inserted block gets ref-based focus after paste, eliminating the deleted `focusLastInsertedBlock` DOM-focus helper.

## Happy paths

- Cross-block selection across two inner paragraphs of a blockquote, paste of multi-block markdown (3 paragraphs): pasted blocks land as inner children of the blockquote, the surviving tail paragraph is preserved, and the caret lands at the end of the last pasted block (verified by typing a marker and asserting its position at the tail of the last pasted paragraph)

## User interactions

- Shift-click cross-block inside a blockquote → Ctrl+V multi-block markdown → type a marker: marker lands at the end of the last pasted block, proving the registry's `innerBlockRefs[lastIdx]?.focus(CURSOR_END)` is correctly resolved (not via the deleted DOM-level fallback)
