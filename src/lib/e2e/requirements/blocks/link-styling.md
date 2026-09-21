# Feature: Link styling and click affordance

Links must read as links without taking the plain click away from editing: a
plain click places the caret, only a Ctrl/Cmd-click follows the link, and the
cursor shows exactly that. Layout and safety follow the same rule: a link
wrapped around an image hugs the image, and a link whose scheme is blocked
never looks clickable.

## Happy paths

- An inline link is underlined and drawn in the accent colour, so it stands
  apart from body text and looks the same as an autolink.
- An image wrapped in a link hugs the image's box instead of stretching the
  link across the full content width, which left the link's hover tooltip
  over empty space beside the image.

## Edge cases

- A link whose scheme is blocked (`javascript:`, for one) renders inert: no
  underline, no accent colour, no pointer cursor, and holding Ctrl/Cmd still
  does not turn it into a pointer.

## User interactions

- Hold Ctrl/Cmd: links and autolinks switch from the text caret to a pointer
  cursor, and releasing it brings the text caret back. A plain click edits,
  only a modifier-click follows the link.
- Release the modifier while the page is unfocused (alt-tab, an OS shortcut):
  the pointer cursor clears on its own instead of sticking until the next
  keypress.
