# Feature: a block with its own editing surface, drawn by the app's framework

The `?block-views` page (`block-views.md`) also draws a ` ```note ` block with the app's
component (`reactBlockView` or `vueBlockView` on the container surface). The kind declares
`blockFocus: 'whole-block'`, so the note has no editable text of the editor's: it's focused as a
whole, like the bundled diagram, and the component hands the editor the element that takes focus
(`ctx.container.attachFocus`). A double click, or Mod+M (the kind's command, which reaches the
component through `ctx.container.setCommandHooks`), swaps in a textarea of the component's own.
Leaving the textarea commits its text through `updateOwnMetadata`; Escape drops the edit. The note
sits between the chip paragraph and `after the blocks`. Every scenario fails on any console error,
page error or console warning.

## Happy paths

- ArrowDown from the chip paragraph stops on the note, focused whole, and a second ArrowDown
  leaves for the paragraph below. ArrowUp walks back the same way.
- A double click opens the textarea with the caret in it; typing a sentence at full speed keeps
  every key, clicking into the paragraph below commits the note once, and one Ctrl+Z restores the
  old text.
- Mod+M at the focused note opens the textarea too, with the caret in it.

## Edge cases

- Shift+Tab from the paragraph below lands on the note's editing host, inside the note, and Tab
  from there goes on to the paragraph below. Tab in a paragraph types a tab, so the way in by Tab
  is from below.
- A character typed at the focused note, and an AltGr-style insert of `€`, each land in a new
  paragraph below it, the note's bytes untouched.
- ArrowUp on the textarea's first line leaves the note for the paragraph above and commits.
- Escape in the textarea drops the edit and leaves the note focused whole, on an editing host
  that survived the component swapping its text for the textarea and back.
- Backspace at the focused note deletes it, and Ctrl+Z brings it back.
