# Feature: Image popover commit

## Happy paths

- Popover appears when widget is selected
- Popover disappears when widget is deselected
- URL field is editable; blur commits the new URL into source
- Alt field is editable; blur commits
- Title field is editable; blur commits
- Empty title field commits with no title in source
- URL edit commits for an image inside a list item (nested-paragraph commit)

## Edge cases

- Blur with no field changes does NOT add an undo entry (no-op short-circuit)
- Invalid URL commits anyway; widget renders broken state
- Switching the popover from one image to another never writes the previous popover's local field state onto the new target. Each popover is bound to the image identity (`paragraphPath` + `sourceStart`) at mount; commits route to that captured target regardless of the live widget selection.
- Pending edits to the URL / alt / title field commit on image-switch (not just on outside-click), targeting the original image. Escape discards pending edits without committing.
