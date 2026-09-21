# Feature: Mermaid empty diagram: the edit box is the view

An empty or whitespace-only ` ```mermaid ` fence has no picture to draw and nothing worth
reporting: the renderer rejects empty input, so an error card would accuse the user of a mistake
they are halfway through making. Its natural editable view is the edit box, and a caret landing
on it lands ready to type, the standard the ` ```math ` fence already sets by showing its source
on entry. Reading mode writes no bytes, so there the empty block shows a dimmed placeholder in
the editor's own style instead.

## Happy paths

- Typing the keystroke that completes ` ```mermaid ` converts the block and lands the caret in
  its edit box; typing carries straight on into the diagram code and commits into the fence
- Deleting a diagram's whole code and committing leaves the block showing its edit box with the
  caret in it, never an error card
- A whitespace-only body counts as empty: the same edit box, and no error card

## Edge cases

- An empty fence round-trips byte for byte, with and without a closing fence
- Reading mode shows a dimmed placeholder for an empty diagram, with no error card and no
  textarea, and the block is still a stop for the arrow keys
