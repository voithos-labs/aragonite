# Feature: Horizontal arrow traversal around image widgets

## Happy paths

- ArrowLeft from the start of a paragraph below a standalone image: press 1 selects the widget, press 2 places the caret at the end of the paragraph above the image
- ArrowRight from the end of a paragraph above a standalone image: press 1 selects the widget, press 2 places the caret at the start of the paragraph below the image
- For an inline image (text both before and after in same paragraph), ArrowLeft from after-image: press 1 selects the widget, press 2 places the caret immediately before the image (end of preceding text)
- For an inline image, ArrowRight from before-image: press 1 selects the widget, press 2 places the caret immediately after the image (start of following text)

## Edge cases

- Caret never lands at a visually-invisible position inside an image widget (the hidden source-bytes span must not act as a caret target)
- Cross-block ArrowLeft/Right into a paragraph that ends/starts with an image selects the widget directly rather than placing an invisible caret at the widget's edge
- Cross-block ArrowUp landing on a standalone image must not place the caret inside the widget's hidden source span — typing afterwards must produce visible text, not a malformed splice into the image source bytes
