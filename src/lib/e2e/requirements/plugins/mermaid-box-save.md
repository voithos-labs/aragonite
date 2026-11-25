# Feature: Mermaid edit box, text not yet written

The diagram's edit box writes its text once, as it closes. Some things end an edit without the
box closing itself first: an undo or a redo the editor runs, a mode switch, a new document, the
box scrolled out of the window. The editor asks the box to save before an undo, a redo or a mode
switch, and a new document drops the text. Every row here is 0.11.5's behaviour, mounted on its
export.

## Happy paths

- An undo the editor runs with text typed in the box: the box closes, the text is saved as the
  step that same undo takes back, so the bytes are as before and a redo writes the text
- A switch to live mode with the box open writes the text as one undo step, which the next undo
  takes back
- A new document with the box open drops the text: the new document's bytes, no undo step

## Edge cases

- The box, with typed text, scrolled out of the window: the text is written as the box leaves,
  one undo step
- An empty diagram's box between two paragraphs: an arrow down into it and on out lands at the
  column it came in with, and the same going back up
- One character typed in the box, then Ctrl+Z and Ctrl+Shift+Z there: the box's own undo and redo
  take it out and put it back, and the editor's undo stack keeps its one step

## User interactions

- The box opened from the toolbar's Edit button and typed in with the keyboard; the editor's undo
  run as a host's toolbar runs it (`runCommand('history.undo')`), since Ctrl+Z in the box is the
  box's own

## Miss-analysis

No row pressed Ctrl+Z or Ctrl+Shift+Z inside the box, so nothing held that a box typed in keeps its
own undo and redo once the editor's take over in an untouched one.

## Error cases

- None: nothing here can fail short of the text being lost, which every row checks
