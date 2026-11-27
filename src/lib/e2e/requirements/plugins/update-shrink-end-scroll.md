# Feature: A drawing that is a moment shorter on update keeps you at the end

You're at the bottom of a long document whose last block a plugin draws. Something the editor
brings changes while your caret is somewhere else: the mode, the theme, your caret leaving the
block, or its fold opening. The editor tells the drawing through `update`, and the drawing
rebuilds itself, a moment shorter while it does (it reads its own width between the clear and the
fill, as a chart library sizing itself does). The browser pulls the scroll up to fit that shorter
document and never gives it back on its own. The editor keeps the position around `update`, so
the reader stays where they were.

Fixture: a hundred and fifty paragraphs, then a `[shrink]` container from the `shrink` harness
seed, whose drawing rebuilds a 400px picture on every update. Run with the editor scrolling itself
and again with the page box around it scrolling (`?scroll=host`). Every test gets to the bottom
with the mouse wheel, puts the caret where its change needs it, and reads the scroll position
before and after the change.

## Happy paths

- Switching to reading mode with the caret in a paragraph above: the scroll position is where it
  was, at the document's end
- Switching the theme with the header toggle, the caret in a paragraph above: the same
- Clicking a paragraph above while the caret is in the container's body: the same
- Opening the folded container with its toggle, the caret in a paragraph above: the scroll
  position is where it was

## Edge cases

- The editor leaves the scroll alone for an edit made with the caret in the block's own text or
  children, so reading mode, the theme and closing the fold also run with the caret in the block,
  where none of them is an edit: each still ends at the document's end (closing the fold from its
  body moves the caret to the title)
- Each test checks its setup before acting: the document really is windowed, the container
  really is at its bottom, and the drawing's `update` really ran for the change, so a fixture that
  stops doing any of those fails instead of passing for nothing
