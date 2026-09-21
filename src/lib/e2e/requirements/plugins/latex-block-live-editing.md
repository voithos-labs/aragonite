# Feature: block math editing keys at the hidden fence lines (live)

While a `$$` block's source is shown in live mode its fence lines are hidden, and the leaf
applies every plain-text edit itself, with the edit range clamped to the offsets the caret may
sit at. So no editing key at a body edge may reach a fence line: Home and End land inside the
body, Enter at the body's end opens a new body line, and a delete aimed at a fence deletes
nothing.

Fixture: `Before` / a four-line `aligned` block / `After` (`?seed=mathblock-multiline`), in
`live`.

## Happy paths

- Home on the first body line lands at its column 0, not before the hidden opener
- End on the last body line lands after its last byte, not past the hidden closer
- Enter at the body's end opens a new body line before the closer, and the blur commits it

## Edge cases

- Backspace at the body's start deletes nothing, and the blur commits nothing
- Delete at the body's end deletes nothing, and the blur commits nothing
- Tab leaves the block, as it leaves a paragraph, since no built-in binds it and it is the
  browser's own focus step, and the blur it causes commits the whole draft

## Miss-analysis

- Backspace at the start of a body was pinned in source mode, where the fence line before it is
  painted and the keypress edits it. The shape with hidden fences, where a browser delete knows
  nothing about hidden markers and Chromium removes the unrendered nodes beside the last visible
  character, had no scenario.
