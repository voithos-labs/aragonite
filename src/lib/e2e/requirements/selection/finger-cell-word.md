# Feature: a finger's word in a table cell

A long press or a double tap in a table cell makes the word the editor's own range, as in any
other block: the editor paints it, draws its two handles and leaves only a caret in the cell, at
the cell's own path with the word's text offsets. Anything done over it does what it does over a
mouse's word in that cell. Chromium only (CDP touch); the long press itself runs on the phones
(`requirements/mobile/android.md` and `ios.md`).

## Happy paths

- A finger's double tap in a cell makes its word the editor's range: the selection is the cell's
  path at the word's offsets, the paint sits inside the cell, two handles stand and no native
  range is left under it.
  - Miss-analysis: the takeover's rows ran in paragraphs only, and a cell's word snapped to a
    single cell, which the editor never paints, so it stayed the browser's and lost its handles.
- The end handle of a finger's word in a cell dragged into the next cell grows a rectangle of the
  two cells; dragged back into its own cell, the range is the cell's text again and still the
  editor's, with no native range for the phone to draw handles on.
  - Miss-analysis: the shrink-back rows started from a rectangle and read only the selection, so
    a native range left in the cell under a finger stayed green.

## Edge cases

Each over a finger's word in a cell, compared with the same thing over a mouse's word there:
the document, the selection and the clipboard come out the same, with no dev warning.

- A typed letter replaces the word.
- A typed `|` replaces the word escaped, so the row keeps its cells.
  - Miss-analysis: an edit over a range inside one block reparsed the survivor as a plain block,
    which turned a cell into a paragraph and wrote the pipe raw; no row edited a range in a cell.
- Backspace takes the word and keeps the cell.
- Backspace over a word that is the cell's whole text leaves the cell empty, never removes it.
- The toolbar's Cut (Ctrl+X for the mouse) takes the word onto the clipboard.
- The toolbar's Copy (Ctrl+C for the mouse) puts the word on the clipboard.
- The toolbar's Paste (Ctrl+V for the mouse) of `a|b` puts it in the word's place, escaped.
- The toolbar's bold wraps the word.
- Shift+ArrowRight from a keyboard grows the word by one character.
