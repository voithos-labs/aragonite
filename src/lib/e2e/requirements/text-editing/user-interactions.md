# Feature: Text Editing — User Interactions

Realistic user flows: click → focus → type, rapid splits, mid-block Backspace.

## User interactions

- type then check source: realistic flow of click → focusBlockEnd → typeText → verify getSource
- split then type in new block: Enter creates block, typing in new block updates source; the halves stay separated by a blank line, so a reload keeps two blocks
- rapid split: press Enter twice quickly, verify three blocks exist
- Backspace mid-block does not merge: Backspace at offset > 0 deletes a character, doesn't trigger merge
