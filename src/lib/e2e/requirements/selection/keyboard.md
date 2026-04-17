# Feature: Keyboard cross-block selection

## Happy paths
- Shift+ArrowDown from block end extends into next block: cross-block mode activates
- Shift+ArrowUp from block start extends into previous block: cross-block mode activates
- Shift+ArrowDown from a mid-block anchor with the focus already at block end extends cross-block: the boundary check reads the selection focus, not the range start, so a non-collapsed selection anchored mid-block still crosses on the next Shift+Arrow
- Ctrl+Shift+End extends selection to document end: cross-block mode activates
- Ctrl+Shift+Home extends selection to document start: cross-block mode activates
- Double Ctrl+A selects entire document: first press selects block, second enters cross-block

## Edge cases
- Shift+ArrowDown at last block: no-op, cross-block stays inactive
- Shift+ArrowUp at first block: no-op, cross-block stays inactive
- Ctrl+A doubling counter resets on non-Ctrl+A keystroke: pressing Ctrl+A after typing starts fresh
- Shift+ArrowDown from paragraph into blockquote: activates cross-block, focus lands inside blockquote

## User interactions
- Unshifted ArrowLeft collapses cross-block selection to range start: exits cross-block mode
- Unshifted ArrowRight collapses cross-block selection to range end: exits cross-block mode
- Click collapses cross-block selection: exits cross-block mode

## Error / degenerate cases
- Empty document (single empty paragraph): double Ctrl+A does not crash, source unchanged
- Thematic break between endpoint blocks: gets whole-block overlay highlight, no crash
