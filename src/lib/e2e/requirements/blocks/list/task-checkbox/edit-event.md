# Block: List — Task Checkbox (edit-event shape and cross-block click)

Toggle emits exactly one `metadataUpdate` op; clicking the checkbox while a cross-block selection is active collapses the selection first.

## Edge cases

- Clicking the checkbox does not change the caret position when the caret was elsewhere (click region is non-editable, browser preserves selection).
- Clicking the checkbox with an active cross-block selection collapses the selection first, then applies the toggle; only the clicked item is affected.

## Regression guards

- Toggle does not emit typing-style keyboard events; emitted edit event has `op: 'metadataUpdate'`.
- Undo after toggle pushes one snapshot (not zero, not two).
