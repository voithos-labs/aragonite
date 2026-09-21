# Feature: Image popover commit

The popover is a toolbar (limestone's cover actions): Alt text, Crop image, Remove image, as
26px buttons beside the image. The alt button opens its field on demand; a plain click
on the image opens nothing but the toolbar. There is no URL field: retargeting an image is a
source-mode edit.

## Happy paths

- Toolbar appears when widget is selected
- Toolbar disappears when widget is deselected
- The alt button opens an alt field with a "Describe the image" placeholder; clicking away or
  Enter commits into source, and Enter also closes the field while the toolbar stays
- The alt commit lands for an image inside a list item (nested-paragraph commit)
- The title has no field; an existing `"title"` survives URL and alt commits byte-for-byte
- The remove button deletes the image span from the paragraph

## Edge cases

- Clicking away with no change to a field does not add an undo entry
- Switching the popover from one image to another never writes the previous popover's local field state onto the new target. Each popover is bound to the image identity (`paragraphPath` + `sourceStart`) at mount; commits go to that captured target whatever the live widget selection is.
- Pending alt edits commit on image-switch (not just on outside-click), targeting the original image. Escape discards pending edits without committing.
