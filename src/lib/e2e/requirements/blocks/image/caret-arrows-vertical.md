# Feature: Vertical arrow traversal around image widgets

An image-only paragraph carries no text column, so a vertical arrow cannot seat a caret in it. It
can still be ENTERED as an object, so vertical travel stops on it once: the first press selects
the image, the second moves on to the next text-bearing block. Both directions read it the same
way, which is what makes an ArrowUp run and the ArrowDown run back retrace the same stops. The
rule is the object, not the image: every widget-only block stops, entered however its kind enters.

Miss-analysis (#326): every case here started and ended on a text-bearing block, so a walk was
only ever asserted at its destination; the stop in between was invisible to the suite, and the two
vertical doors, the per-block landing and a container's column entry, each carried their own
answer for it.

## Happy paths

- ArrowUp from the start of the paragraph below a standalone image selects the image; a second
  press lands in the text-bearing paragraph above it.
- ArrowDown from the end of the paragraph above a standalone image selects the image; a second
  press lands in the text-bearing paragraph below it.
- ArrowUp from a list item below an image-only list item selects that item's image; a second press
  lands above the whole list.
- ArrowDown from a paragraph above a list whose first item is image-only selects that item's
  image; a second press lands in the next text-bearing list item.
- ArrowUp from a paragraph below a list whose last item is image-only selects that item's image; a
  second press lands in the preceding text-bearing item.

## Edge cases

- For an inline (mid-paragraph) image, ArrowUp from the line after the image lands at the line
  before it: the surrounding paragraph has text positions, so nothing here applies.
