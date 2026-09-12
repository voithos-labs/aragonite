# Feature: block math editing keys at the hidden fence lines (live)

While a `$$` block's source is revealed in live mode its fence lines are hidden, and the leaf
applies every plain-text edit itself with the edit range clamped to the landable span. So no
editing key at a body edge may reach a fence line: a line extreme seats inside the body, an Enter
at the body end opens a body line, and a delete pointed at the fence deletes nothing.

Fixture: `Before` / a four-line `aligned` block / `After` (`?seed=mathblock-multiline`), in `live`.

## Happy paths

- Home on the first body line seats at its column 0, not before the hidden opener
- End on the last body line seats after its last byte, not past the hidden closer
- Enter at the body end opens a new body line before the closer, and the blur commits it

## Edge cases

- Backspace at the body start deletes nothing; the blur commits nothing
- Delete at the body end deletes nothing; the blur commits nothing
- Tab leaves the block, as it leaves a paragraph (no built-in binds it, so it is the browser's
  focus step), and the blur it causes commits the draft whole

## Miss-analysis

- Backspace at a body start was pinned in source mode, where the fence line before it paints
  and the press edits it; the hidden-fence shape, where a native delete has no notion of chrome
  and Chromium removes the unrendered nodes beside the last visible character, had no scenario.
