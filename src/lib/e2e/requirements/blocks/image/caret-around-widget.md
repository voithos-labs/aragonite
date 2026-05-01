# Feature: Caret traversal around image widgets

## Vertical (ArrowUp / ArrowDown)

- ArrowUp from the start of the paragraph below a standalone image lands at the previous text-bearing paragraph (skips the image-only paragraph) in one press
- ArrowDown from the end of the paragraph above a standalone image lands at the next text-bearing paragraph (skips the image-only paragraph) in one press
- ArrowUp from a list item paragraph below a list-item that contains only an image lands above the entire list in one press (vertical-skip cascades through the container)
- For an inline (mid-paragraph) image, ArrowUp from the line after the image lands at the line before the image — native browser handles this correctly because the surrounding paragraph has text positions

## Horizontal (ArrowLeft / ArrowRight)

- ArrowLeft from the start of a paragraph below a standalone image: press 1 selects the widget, press 2 places the caret at the end of the paragraph above the image
- ArrowRight from the end of a paragraph above a standalone image: press 1 selects the widget, press 2 places the caret at the start of the paragraph below the image
- For an inline image (text both before and after in same paragraph), ArrowLeft from after-image: press 1 selects the widget, press 2 places the caret immediately before the image (end of preceding text)
- For an inline image, ArrowRight from before-image: press 1 selects the widget, press 2 places the caret immediately after the image (start of following text)

## Edge cases

- Caret never lands at a visually-invisible position inside an image widget (the hidden source-bytes span must not act as a caret target)
- Cross-block ArrowLeft/Right into a paragraph that ends/starts with an image selects the widget directly rather than placing an invisible caret at the widget's edge
- A paragraph containing only image widget(s) is treated as vertically transparent — ArrowUp/Down passes through without stopping
