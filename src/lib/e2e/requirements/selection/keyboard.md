# Feature: Keyboard cross-block selection

## Happy paths
- Shift+ArrowDown from block end extends into next block: cross-block mode activates
- Shift+ArrowUp from block start extends into previous block: cross-block mode activates
- Ctrl+Shift+End extends selection to document end: cross-block mode activates
- Ctrl+Shift+Home extends selection to document start: cross-block mode activates
- Double Ctrl+A selects entire document: first press selects block, second enters cross-block

## Edge cases
- Shift+ArrowDown at last block: no-op, cross-block stays inactive
- Shift+ArrowUp at first block: no-op, cross-block stays inactive
- Ctrl+A doubling counter resets on non-Ctrl+A keystroke: pressing Ctrl+A after typing starts fresh

## User interactions
- Unshifted ArrowLeft collapses cross-block selection to range start: exits cross-block mode
- Unshifted ArrowRight collapses cross-block selection to range end: exits cross-block mode
- Click collapses cross-block selection: exits cross-block mode
