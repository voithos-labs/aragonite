# Block: List — Task Checkbox (selection across ambient region)

Backspace and Delete on a selection that crosses into the contenteditable="false" checkbox island must remove the selected editable text — native delete silently fails on such ranges, so the editor intercepts.

## Regression guards

- Selection extending into the checkbox region: Backspace and Delete correctly remove the selected editable text (intercepted because native delete silently fails on ranges that overlap contenteditable="false" content).
- Backspace with a selection entirely within editable content still uses native — control case to ensure the override does not regress normal selection-delete.
