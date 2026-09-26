# Feature: One gesture, one undo entry

A gesture that takes several commits undoes in one Ctrl+Z, back to the exact bytes and selection
from before it, and redoes in one Ctrl+Shift+Z to the exact bytes and selection after it.

## Happy paths

- Paste over a range spanning three blocks: one entry; undo restores the text and the painted range
- Typing a character over that range: one entry; undo restores the text and the range
- Enter over that range: the delete and the split are one entry, not two (#559)
- Mod+2 over that range: the delete and the heading are one entry
- A word dragged into another paragraph: the cut and the insert are one entry
- Replace-all across three paragraphs: one entry for every block it rewrote; the bytes round-trip,
  and the caret comes back at the first match, since the search field held focus before

## Edge cases

- Typing `# ` at the start of a paragraph: the keystroke that reparses the block joins the typing
  around it, so one undo takes back both characters. Miss-analysis: the typing suites counted
  entries around a split, which a commit of its own also satisfies.
- An inline-menu slash pick after text: the cleared query and the block the source inserts are one
  entry
