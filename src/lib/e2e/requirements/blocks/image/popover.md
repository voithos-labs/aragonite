# Feature: Image properties popover

## Happy paths
- Popover appears when widget is selected
- Popover disappears when widget is deselected
- URL field is editable; blur commits the new URL into source
- Alt field is editable; blur commits
- Title field is editable; blur commits
- Empty title field commits with no title in source

## Edge cases
- Blur with no field changes does NOT add an undo entry (no-op short-circuit)
- Invalid URL commits anyway; widget renders broken state
