# Feature: Image popover portal isolation

## User interactions

- Typing into a popover input updates the input value, does not delete the image
- Clicking from one popover input to another keeps the popover open and focuses the clicked field

## Layout

- Opening the popover does not shift the widget or the block below it (no layout reflow)
- Popover field labels stay inside popover bounds even when the image is in a list item
