# Feature: a click on a painted glyph reports that glyph's raw offset

A click puts the caret where the user pointed, and the editor turns that DOM position into a raw
offset by walking the block: it counts a list item's marker prefix, a widget's source bytes, and
the bytes of markers live mode hides. Each scenario aims at a glyph found in the painted text
alone, never at a point computed from a raw offset, so a miscount in that walk shows up as a
wrong reported offset. It lives in the plugins project because the emoji widget needs its seed.

The document is `- alpha beta`, then `Mood :smile: today`, then `Some **bold** text`. Each click
aims at a glyph a little way into its text, away from the edge of a marker or widget, where the
caret position is decided by the browser's edge rules rather than by the walk.

Miss-analysis: every click test aimed through the editor's own raw-to-DOM mapping, which reads the
same prefix length, widget length and hidden-marker count as the DOM-to-raw walk the click goes
through, so a miscount in any of them moved the aim and the answer together and the test passed.

## Happy paths

- A click on the second letter of a list item's text (the `l` of `alpha`, just past the `- `
  marker) puts the caret at raw offset 1 of the item's paragraph
- A click on the first letter of the word after an emoji glyph (the `t` of `today`) puts the
  caret at raw offset 13, counting all seven bytes of `:smile:` behind the one glyph

## Edge cases

- In live mode, with the `**` markers hidden, a click on the `l` of `bold` puts the caret at raw
  offset 9, counting the hidden `**` before it
