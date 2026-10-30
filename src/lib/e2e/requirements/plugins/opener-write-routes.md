# Feature: an opener written by any route leaves the block below whole

A line that's only `$$` or `:::name` reads as a paragraph until a line below closes it, and the
first such line below is usually the opener of the next block of its family. So an opener written
above one would take in every block down to it. Whatever wrote the opener, it gets its own closing
line instead (`$$\n$$`, `:::note\n:::`), and the block below keeps its bytes and its kind.
`<details>` is the control: an HTML block ends at a blank line, so it never waits on the block
below and gets no closer.

Driven on `/test/plugins?seed=math` in source and live mode, one row per route and opener. Each row
reads the whole document's bytes, the last block's kind, and whether the tree reloads as itself.
The rows for `$$` and `:::note` go red with the closing step taken out of `legalizeWrite` and
`closeWrittenOpeners`, except the typed `$$`, which the completer closes on its own.

Miss-analysis (#800, #801): every row typed its opener, so the routes that write by other means (a
paste, a drop, a split, a range delete, a move, find and replace, a block command) had no row and
four of them never reached the step that adds the closer.

## Happy paths

- typed one key at a time into an empty line: `$$` is a math block around an empty body line,
  `:::note` closes at its first letter, `<details>` is written as typed
- `$`, Home, `$` on an empty line: the second `$` lands in front of the first, where the auto-pair
  declines to pair, and the `$$` it finishes gets a closer
- pasted into an empty line as one line of text
- pasted as two blocks, the opener first and `foo` after it: the opener is closed at its own
  block's end, above `foo`
- dropped: the opener's text, selected with Shift+ArrowLeft at the end of `from <opener>` and
  dragged onto the empty line below
- pasted over a selection from the start of one paragraph to the end of the next
- joined by a range delete: Shift+click from the middle of one half to just past the `z` in front of
  the other, then Backspace
- split off by Enter from `x<opener>` with the caret after the `x`
- written by find and replace: Replace All turns `QQ` into the opener
- written by the block menu's Replace with clipboard on a code block, the command that writes a
  block's bytes wholesale
- moved above the block with Alt+ArrowUp from the end of the document

## Edge cases

- a write into an empty paragraph keeps the blank line that paragraph was, below the opener
- `<details>` on every route but the auto-pair one: written as is, no closer, the details block
  below unchanged

## User interactions

- keys, Shift+click, a drag, a right-click menu, the find bar and Alt+ArrowUp through the browser;
  the caret before each gesture is placed by the editor's own selection call

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
