# Feature: emoji shortcodes as atomic glyph widgets

GitHub `:shortcode:` emoji render as atomic glyph widgets on the bare `:` trigger.
The literal `:smile:` bytes stay in the source; the widget shows only the glyph.
Seed `emoji`: block 0 `Mood :smile: today` (one `:smile:` reference), block 1
`Type here` (a typing target). The widget carries the decoded-entity editing policy
— `deleteGranularity: 'atomic'`, `onEdge: 'step-over'`.

## Happy paths

- Seed render: block 0 shows one `.md-emoji-widget` reading 😄; the raw `:smile:`
  bytes stay in the source.
- Type a shortcode live: typing `:tada:` into prose renders a fresh glyph widget
  once the closing `:` lands; before it, `:tada` stays literal text.

## User interactions

- Arrow steps over: with the caret at the reference's leading edge, one ArrowRight
  moves the caret across the whole widget like a single character — a character typed
  next lands immediately after the closing colon.
- Atomic Backspace: with the caret at the reference's trailing edge, one Backspace
  removes the whole `:smile:` reference (not one byte); a single undo restores it —
  the delete is one commit, one undo entry.
- Copy: copying a range that contains the reference yields the `:smile:` source
  bytes on the clipboard, never the 😄 glyph.

## Error cases

- Uninstalled parity is a unit concern (recognizer.test.ts): with the plugin absent
  `:smile:` is literal prose. The e2e runs only with the plugin installed and asserts
  no console errors are captured across every gesture.
