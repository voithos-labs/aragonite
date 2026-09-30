# Feature: Keyboard cross-block selection, happy paths

Baseline cross-block extension via Shift+Arrow, Ctrl+Shift+End/Home, and double Ctrl+A.

## Happy paths

- Shift+ArrowDown from block end extends into next block: cross-block mode activates
- Shift+ArrowUp from block start extends into previous block: cross-block mode activates
- Shift+ArrowDown from a mid-block anchor with the focus already at block end extends cross-block: the boundary check reads the selection focus, not the range start, so a non-collapsed selection anchored mid-block still crosses on the next Shift+Arrow
- Ctrl+Shift+End extends selection to document end: cross-block mode activates
- Ctrl+Shift+Home extends selection to document start: cross-block mode activates
- Double Ctrl+A selects entire document: first press selects block, second enters cross-block
- Ctrl+A over a range made by a drag selects the whole document in one press: the drag never counted a first press, so the range itself is what sends the chord document-wide
