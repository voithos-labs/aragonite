# Feature: block math editing keys at the hidden fence lines (live)

While a `$$` block's source is shown in live mode its fence lines are hidden, and the leaf
applies every plain-text edit itself, with the edit range clamped to the offsets the caret may
sit at. So no editing key at a body edge may reach a fence line: Home and End land inside the
body, Enter at the body's end opens a new body line, and a delete aimed at a fence deletes
nothing.

A selection is the one gesture that reaches past those offsets, because it can end in another
block. The rule there: bytes written past the block's own editable element put back a closer the
write dropped, so the block keeps its kind and absorbs what the range reached, exactly as a fenced
code block does. Deleting the fence bytes by hand inside the open source still converts the block
to a paragraph (`latex-block-commit-split.md`), because those are bytes the user addressed.

Fixture: `Before` / a four-line `aligned` block / `After` (`?seed=mathblock-multiline`), in
`live`; the range scenarios use the one-line `$$x^2$$` block (`?seed=mathblock`), whose closer
sits on the body's own line where a range through the body reaches it.

## Happy paths

- Home on the first body line lands at its column 0, not before the hidden opener
- End on the last body line lands after its last byte, not past the hidden closer
- Enter at the body's end opens a new body line before the closer, and the blur commits it

## Edge cases

- Backspace at the body's start deletes nothing, and the blur commits nothing
- Delete at the body's end deletes nothing, and the blur commits nothing
- Tab leaves the block, as it leaves a paragraph, since no built-in binds it and it is the
  browser's own focus step, and the blur it causes commits the whole draft

- Home then six Shift+ArrowRight out of a one-line block's body, then Backspace: the range is
  deleted, the text it reached is absorbed into the body, and the block is still math
  (`$$After$$`), never a paragraph opening with a stray `$$`
- one undo after that range delete puts the block and the paragraph below it back

## Miss-analysis

- Backspace at the start of a body was pinned in source mode, where the fence line before it is
  painted and the keypress edits it. The shape with hidden fences, where a browser delete knows
  nothing about hidden markers and Chromium removes the unrendered nodes beside the last visible
  character, had no scenario.
- Every editing scenario drove keys at a collapsed caret inside the body, where the clamp keeps
  the fence out of reach. A range is the one gesture that leaves the block, and no scenario made
  one, so nothing asked what the block's own bytes look like after a tree operation truncated
  them.
