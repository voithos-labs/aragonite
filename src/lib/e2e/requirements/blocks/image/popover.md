# Feature: Image properties popover

## Happy paths

- Popover appears when widget is selected
- Popover disappears when widget is deselected
- URL field is editable; blur commits the new URL into source
- Alt field is editable; blur commits
- Title field is editable; blur commits
- Empty title field commits with no title in source
- URL edit commits for an image inside a list item (nested-paragraph commit)

## User interactions

- Typing into a popover input updates the input value, does not delete the image
- Clicking from one popover input to another keeps the popover open and focuses the clicked field

## Layout

- Popover is anchored just below the widget, not at end of editor flow
- Opening the popover does not shift the widget or the block below it (no layout reflow)
- Popover field labels stay inside popover bounds even when the image is in a list item

## Edge cases

- Blur with no field changes does NOT add an undo entry (no-op short-circuit)
- Invalid URL commits anyway; widget renders broken state
- Switching the popover from one image to another never writes the previous popover's local field state onto the new target. Each popover is bound to the image identity (`paragraphPath` + `sourceStart`) at mount; commits route to that captured target regardless of the live widget selection.
- Pending edits to the URL / alt / title field commit on image-switch (not just on outside-click), targeting the original image. Escape discards pending edits without committing.
