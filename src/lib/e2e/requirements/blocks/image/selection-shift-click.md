# Feature: Shift+click with an image selected

## User interactions

- Shift+click in the text after a selected image: the image deselects and the range runs from
  the image's start to the press, so a typed character replaces the image and the text after it up to the press
  and leaves the text before it
- Shift+click in the text before a selected image: the range runs from the press to the image's
  end, and a typed character leaves the text after it
  - Miss-analysis: every shift-click spec grew from a caret, and no spec pressed Shift while an
    image held the selection, where no caret exists and the popover's outside-press handler ended
    the selection before the block read it
- Shift+click at the start of a list item's text before a selected image, then Shift+ArrowRight:
  the press stays the moving end, so the range shrinks from the text's first letter
  - Miss-analysis: the unit restore case had no marker span, and the only shift-click specs ran
    in paragraphs, so no test started a backward range at raw 0 behind a list marker
