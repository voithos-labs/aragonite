# Feature: Vertical arrow traversal around image widgets

## Happy paths

- ArrowUp from the start of the paragraph below a standalone image lands at the previous text-bearing paragraph (skips the image-only paragraph) in one press
- ArrowDown from the end of the paragraph above a standalone image lands at the next text-bearing paragraph (skips the image-only paragraph) in one press
- ArrowUp from a list item paragraph below a list-item that contains only an image lands above the entire list in one press (vertical-skip cascades through the container)
- ArrowDown from a paragraph above a list whose first item is image-only lands in the next text-bearing list item (transparent items are skipped on container entry)
- ArrowUp from a paragraph below a list whose last item is image-only lands in the preceding text-bearing list item (transparent items are skipped on container entry)

## Edge cases

- A paragraph containing only image widget(s) is treated as vertically transparent — ArrowUp/Down passes through without stopping
- For an inline (mid-paragraph) image, ArrowUp from the line after the image lands at the line before the image — native browser handles this correctly because the surrounding paragraph has text positions
