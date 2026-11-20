# Feature: the browser's own formatting keys do nothing

A browser underlines, bolds or italicises a selection in editable text on its own shortcut. The
editor writes its marks as Markdown, so a shortcut it doesn't bind (Ctrl+U: Markdown has no
underline) changes nothing, and the selection stays where it was.

Miss-analysis: every format row pressed a chord the editor binds, so none pressed the one the
browser answers itself. Its underline went into the block as an element, the read-back threw it
away, and the selection collapsed.

## Happy paths

- a word selected in a paragraph, Ctrl+U: the source is unchanged and the word is still selected
- the same in a code block

## Edge cases

- Ctrl+B right after, in the paragraph: the word is bold, since the selection survived

## User interactions

- real keystrokes: Shift+Arrow to select, then the shortcut
