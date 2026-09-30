# Block: List, Hanging-Indent Style

The first prose child of a list item that wears a leading marker gets `padding-left: <ambientLength>ch` and the matching negative `text-indent`, so wrapped lines and continuation paragraphs hang under the content rather than under the marker. A marker that draws itself, such as the task checkbox, declares its own width in place of the `ch` pair, and that width follows the mode: source mode reserves what its visible `- [ ] ` draws at the first child's own size, the rendered modes what the painted box takes.

## Edge cases

- The first prose child of a list item with a leading marker has a hanging-indent style measured from the marker's length. The values track `ambientLength`, so they stay correct as the marker widens (task checkboxes at 0.6.1, for one).
- A to-do reserves, in source mode, an indent at least as wide as the marker drawn there, within a pixel (the indent is a fixed width fitted to the editor's font). A to-do can no longer start with a heading: the parser reads `- [ ] # x` as text, and cycling the item to a heading drops the marker.
  - Miss-analysis: the indent cases all ran on a first child at the editor's own text size, where every way of writing the width gives the same number, so nothing measured the indent against a marker that draws wider than the editor's base.
- Non-first prose children carry no such style.
