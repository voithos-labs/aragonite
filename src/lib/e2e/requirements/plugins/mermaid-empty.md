# Feature: Mermaid empty diagram — the edit surface IS the view

An empty (or whitespace-only) ` ```mermaid ` fence has no picture to draw and nothing worth
reporting: the engine rejects empty input, so an error card would accuse the user of a mistake
they are halfway through making. Its natural editable view is the edit surface, and a caret
landing on it lands typing-ready — the bar the ` ```math ` fence already sets by revealing its
source on entry. Reading mode writes no bytes, so there the empty block shows a dimmed
placeholder in the house style instead.

## Happy paths

- Typing the keystroke that completes ` ```mermaid ` converts the block and lands the caret in
  its edit surface; typing continues straight into the diagram code and commits into the fence
- Deleting a diagram's whole code and committing leaves the block in its edit surface with the
  caret in it, never an error card
- A whitespace-only body is treated as empty (same edit surface, no error card)

## Edge cases

- An empty fence round-trips byte-exactly, with and without a closing fence
- Reading mode shows a dimmed placeholder for an empty diagram — no error card, no textarea,
  and the block stays an arrow stop
