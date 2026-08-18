# Feature: Debug panel

## Happy paths

- Ctrl+Shift+D opens the panel from the default closed state.
- Ctrl+Shift+D pressed again closes the panel.
- Reload with the panel open — panel is still open (state persisted in localStorage).
- Reload with the panel closed — panel is still closed.
- Copy-all button writes a fenced markdown blob to the clipboard containing every section's text.
- Raw-source section is read-only. Previously edit-through (textarea + 200ms debounce); removed because setting the editor's `source` prop re-initializes the editor and wipes undo / selection / CST. Use `window.__test.setSource(md)` from DevTools for the rare repro-paste case.

## User interactions

- Ctrl+Shift+D (or Cmd+Shift+D on macOS): toggle panel open/closed.
- Esc when focus is inside the panel: close panel.
- Click a section header: toggle expanded state; state persists across reload.

## Edge cases

- Hotkey pressed while focus is in the editor (contenteditable): panel still toggles; editor does not receive a 'D' character.
- Panel opens with every section rendering in document order and the CST tree section populated for the default document.
- The inline tree populates whether the block gains focus before or after the section expands.
