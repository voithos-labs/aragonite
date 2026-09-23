# Feature: Undo cursor anchoring for input with no keydown

Text can arrive through an input event with no keydown before it: an IME commit, dictation, a
soft keyboard. Undoing it puts the caret back where the text went in, as it does for typed keys.

## Edge cases

- Text inserted by an input event alone after `abc` in `abc tail`, then undo once the batch
  closes: the text goes and the caret sits at offset 3, not at the paragraph start
- An IME composition started after `abc` and committed, then undo: the caret sits where the
  composition began
- Text inserted by an input event alone into a table cell after arrowing to offset 3, then undo:
  the next typed character lands at offset 3, not where the last arrow key left the caret
  - Miss-analysis: every undo-caret spec typed through keydown, which each block read the
    pre-edit caret on, so no spec produced an input with no keydown before it
