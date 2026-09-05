# Feature: Debug panel

## Happy paths

- Ctrl+Shift+D opens the panel from the default closed state.
- Ctrl+Shift+D pressed again closes the panel.
- Reload with the panel open — panel is still open (state persisted in localStorage).
- Reload with the panel closed — panel is still closed.
- Copy-all button writes a fenced markdown blob to the clipboard containing every section's text.
- Raw-source section is read-only (no textarea): setting the editor's `source` prop re-initializes the editor and wipes undo, selection and CST, so a repro-paste goes through `window.__test.setSource(md)` from DevTools.
- `serializeDiagnostics()` omits the document body by default and carries it only under `{ includeSource: true }`, which adds the Source section.

## User interactions

- Ctrl+Shift+D (or Cmd+Shift+D on macOS): toggle panel open/closed.
- Esc when focus is inside the panel: close panel.
- Click a section header: toggle expanded state; state persists across reload.
- Click a block with the Selection section open: the section shows that block's path.
- Type a character with the interaction trace enabled: the trace records a `text-render` rebuild and no composition entries (a plain keystroke is not IME composition).

## Edge cases

- Hotkey pressed while focus is in the editor (contenteditable): panel still toggles; editor does not receive a 'D' character.
- Panel opens with every section rendering in document order and the CST tree section populated for the default document.
- The inline tree populates whether the block gains focus before or after the section expands.
