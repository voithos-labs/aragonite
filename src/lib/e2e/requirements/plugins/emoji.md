# Feature: emoji shortcodes as atomic glyph widgets

GitHub `:shortcode:` emoji render as glyph widgets, recognized from a bare `:`. The literal
`:smile:` bytes stay in the source and the widget shows only the glyph. Seed `emoji`: block 0 is
`Mood :smile: today` (one `:smile:` reference) and block 1 is `Type here`, somewhere to type.
The widget edits the way a decoded entity does: `deleteGranularity: 'atomic'`,
`onEdge: 'step-over'`.

## Happy paths

- Seed render: block 0 shows one `.md-emoji-widget` reading 😄, and the raw `:smile:` bytes stay
  in the source.
- Type a shortcode live: typing `:tada:` into prose renders a fresh glyph widget once the
  closing `:` lands; until then, `:tada` stays literal text.

## User interactions

- Arrow steps over: one press crosses the whole widget each way, with or without Shift
  (`caret/motion-class.md`).
- Backspace deletes it whole: with the caret at the reference's trailing edge, one Backspace
  removes the entire `:smile:` reference rather than one byte, and a single undo restores it, so
  the delete is one commit and one undo entry.
- Live editing around it: in live mode, a character typed before the reference leaves the glyph
  drawn, six ArrowRights from after it cross the glyph whole, and after typing past it two
  Backspaces take the typed character and then the whole reference.
- Copy: copying a range that contains the reference puts the `:smile:` source bytes on the
  clipboard, never the 😄 glyph.
- Click past a run: with four shortcodes flush against each other at the end of a line, a click
  past the last glyph puts the caret after the last one's bytes, so a typed character lands at
  the end of the line.
  Miss-analysis: the row ran only in Chromium, which leaves that click outside the text, and real
  Firefox parks it in the text before the run, which the snap kept as a caret already in text.
- Click on a glyph: a click on the glyph's left half puts the caret before its bytes and one on
  the right half after them, in either presentation mode. The glyph reads as one character, so
  clicking it picks an edge the way clicking beside it does.
  Miss-analysis: the click specs all aimed beside a widget, because a point inside one belonged
  to selecting the whole widget, and no test asked what a click on a glyph the caret steps over
  should do instead.
- Click on a glyph in reading mode: the click moves focus to the block and leaves a collapsed
  caret, exactly as a click beside a widget already did, and writes nothing.

## Error cases

- What happens with the plugin not installed is a unit concern (`recognizer.test.ts`): without
  it, `:smile:` is literal prose. The e2e runs only with the plugin installed and asserts that
  no console errors are captured across any gesture.
