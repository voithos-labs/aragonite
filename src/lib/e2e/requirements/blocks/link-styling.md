# Feature: Link styling and click affordance

Links must read as links without stealing the plain click from editing: a
plain click places the caret, only a Ctrl/Cmd-click activates the link, and
the cursor advertises exactly that. Layout and safety follow the same rule —
a link-wrapped image hugs the image, and a blocked-scheme link never looks
clickable.

## Happy paths

- An inline link is underlined and drawn in the accent colour — visually
  distinct from body text and identical in treatment to an autolink.
- An image wrapped in a link hugs the image's box instead of stretching the
  link across the full content width (which parked the link's hover tooltip
  over empty space beside the image).

## Edge cases

- A blocked-scheme link (e.g. `javascript:`) renders inert: no underline, no
  accent colour, no pointer cursor — and holding Ctrl/Cmd still does not turn
  it into a pointer.

## User interactions

- Hold Ctrl/Cmd: links and autolinks switch from the text caret to a pointer
  cursor; release it and the text caret returns — a plain click edits, only a
  modifier-click activates.
- Release the modifier while the page is unfocused (alt-tab, OS shortcut):
  the pointer affordance clears on its own instead of sticking until the next
  keypress.
