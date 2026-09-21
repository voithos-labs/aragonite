# Block: List — Hanging-Indent Style

The first prose child of an ambient-wearing list item gets `padding-left: <ambientLength>ch` and the matching negative `text-indent` so wrapped lines and continuation paragraphs hang under the content rather than under the marker. A marker that draws itself, such as the task checkbox, declares its own width in place of the `ch` pair, and that width follows the mode: source mode reserves what its visible `- [ ] ` draws at the first child's own size, the rendered modes what the painted box takes.

## Edge cases

- First prose child of an ambient-wearing list item has hanging-indent style scoped by ambient length. Values track `ambientLength` so they stay correct as the marker widens (e.g. task checkboxes at 0.6.1).
- A to-do whose first child is a heading reserves, in source mode, an indent at least as wide as the marker drawn there.
  - Miss-analysis: the indent cases all ran on a first child at the editor's own text size, where every way of writing the width gives the same number, so nothing measured the indent against a marker that draws wider than the editor's base.
- Non-first prose children carry no such style.
