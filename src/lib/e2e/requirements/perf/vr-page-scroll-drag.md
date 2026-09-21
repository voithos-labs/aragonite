# Feature: Drag autoscroll when the page's own viewport is the scrollport

The autoscroll edge math compares the pointer against the scroll container's rect. In a
page-scrolled host embedding no element has that rect: the search up the tree finds nothing
scrollable above the editor, and `document.scrollingElement`'s box is the whole document,
thousands of pixels tall, so a pointer at the bottom of the screen is nowhere near its bottom
edge. The window is a first-class target: the rect comes from the viewport, the write goes to
the scrolling element.

Fixture: `/test/page-scroll`, scrolled to a reading position with a block in view to
grab by its hover handle.

## User interactions

- A block drag held in the bottom edge band of the screen scrolls the page down. Without the
  window as a target the list of targets is empty in this shape and the drag scrolls nothing,
  leaving an off-screen destination unreachable by pointer.
- The same drag held in the top edge band scrolls the page up (the negative half of the
  same math, on a page with somewhere to go).
- Escape cancels each drag, so both assertions are about scrolling only, not about a
  drop.

## Error cases

- No uncaught page errors surface during the drag or the autoscroll loop.
