# Feature: Keyboard cross-block selection — Shift+Arrow contraction (D1)

Shift+ArrowLeft/Right on a non-collapsed single-block selection contracts the selection without firing cross-block extension.

## User interactions

- Shift+ArrowLeft contracts a forward single-block selection (anchor=0, focus=N) without firing cross-block extension: focus moves N→N-1, cross-block stays inactive
- Shift+ArrowRight contracts a backward single-block selection (anchor=N, focus=0) without firing cross-block extension: focus moves 0→1, cross-block stays inactive

## Post-entry contraction (E-F1)

- Enter cross-block (Shift+ArrowDown from a block end), then Shift+ArrowUp back into the anchor block: cross-block goes inactive and the native single-block range is restored (visible, non-collapsed)
- Copy after such a contraction reproduces the restored single-block range, not an empty/garbage payload
