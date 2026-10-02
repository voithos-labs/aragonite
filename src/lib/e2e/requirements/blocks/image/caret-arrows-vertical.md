# Feature: Vertical arrow traversal around image widgets

An image-only paragraph has no column of text, so a vertical arrow cannot put a caret in it. It
can still be entered as an object, so vertical travel stops on it once: the first press selects
the image, the second moves on to the next block with text. Both directions read it the same
way, which is what makes a run of ArrowUp and the run of ArrowDown back retrace the same stops.
The rule is about the object, not the image: every widget-only block stops, entered however its
kind is entered.

Miss-analysis (#326): every case here started and ended on a block with text, so a run of arrows
was only ever checked at its destination; the stop in between was invisible to the suite, and the
two ways a vertical arrow enters a block, the per-block landing and a container's column entry,
each had their own answer for it.

Miss-analysis (#574): every image-only paragraph here fit on one line, so the first-line check was
never asked about a second line in a block with no text, where it read the missing text as an
empty block and let ArrowUp leave from anywhere.

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
- Two adjacent images wrapped onto two lines, caret at the paragraph's end beside the second:
  ArrowUp stays in the paragraph, since the first line is still above it.
