# Feature: Image popover commit, then a second image

## Edge cases

- With two images in one paragraph, an alt edit typed on the first and a click on the second:
  the first image's edit lands as its toolbar closes, and the second image is selected on that
  first click, its toolbar showing its own alt
  - Miss-analysis: every popover spec closed the toolbar by clicking text or another block, so
    none moved to a second image whose bytes the closing write shifted, and the stale-selection
    check dropped the selection the click had just made
- Undo of that first edit: the caret comes back live at the first image's end, where the click
  that selected it put the caret
