# Feature: Image popover portal isolation

## User interactions

- Typing into a toolbar field updates the input value, does not delete the image
- Closing and reopening the alt field keeps the toolbar open and focuses the field

## Layout

- Opening the toolbar does not shift the widget or the block below it (no layout reflow)
- An open field's input stays inside the field surface even when the image is in a list item
