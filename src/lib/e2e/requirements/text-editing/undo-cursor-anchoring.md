# Feature: Text Editing — Undo Cursor Anchoring (C2 / C3)

After undo, the caret returns to the pre-edit position so the next keystroke continues at the user's original location.

## Edge cases

- C2: undo after typing returns caret to pre-edit position; the next typed character lands at the original caret site, not at the end of the restored text
- C3: undo after Ctrl+1 heading-toggle returns caret to pre-edit position; the next typed character lands where the user was before the kind change
