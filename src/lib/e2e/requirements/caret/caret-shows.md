# Caret: a caret the editor writes beside a picture shows

A picture is laid out as a block, so a caret beside it has no line of its own and no browser draws
one there. Whichever route puts the caret beside a picture, the drawn caret's bar shows it at the
picture's edge, on any pointer, and the next typed letter lands at that edge. Beside a widget that
sits in a line (a decoded entity, a formula), the browser's own caret already shows, so the bar stays away.
Each row runs in live mode.

Miss-analysis: only a click asked for the bar beside a picture, and every bar row was a click, so
no row wrote the caret there by a key, a merge or an undo, where nothing drew it and Chromium
dropped the selection, or the typed letter beside a linked picture.

## Happy paths

- `![x](…)` alone, caret put at its start: the bar stands before the picture, and `Q` lands at 0
- the same, caret put at its end: the bar stands after it, and `Q` lands at the end
- `[![alt](…)](https://x.y)` alone, caret put at its start and at its end: the bar stands at that
  edge, and `Q` lands outside the link on that side

## User interactions

- Backspace on an empty paragraph below a picture: the bar stands after the picture, and `Q` lands
  after it
- Backspace on an empty paragraph below a linked picture: the same, `Q` after the link
- `Q` typed after a picture, then undo: the bar stands after the picture again, and `Q` lands there
- Enter after a picture, then Backspace: the bar stands after the picture, and `Q` lands there

## Edge cases

- `lead &copy;`, caret put at its end: the browser's own caret shows beside the ©, no bar, and
  `Q` lands at the end
