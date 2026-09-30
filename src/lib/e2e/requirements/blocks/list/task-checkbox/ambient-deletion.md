# Block: List, Task Checkbox (selection across ambient region)

Backspace and Delete on a selection that reaches into the contenteditable="false" checkbox must remove the selected editable text. The browser's own delete quietly fails on such ranges, so the editor steps in.

## Regression guards

- Selection extending into the checkbox region: Backspace and Delete correctly remove the selected editable text (the editor steps in because the browser's own delete quietly fails on ranges that overlap contenteditable="false" content).
- Backspace with a selection entirely within editable content still leaves it to the browser: the control case, to make sure the override does not break a normal selection-delete.
