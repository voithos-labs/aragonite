# Block: List — Hanging-Indent Style

The first prose child of an ambient-wearing list item gets `text-indent: -<ambientLength>ch; padding-left: <ambientLength>ch` so wrapped lines and continuation paragraphs hang under the content rather than under the marker.

## Edge cases

- First prose child of an ambient-wearing list item has hanging-indent style scoped by ambient length. Values track `ambientLength` so they stay correct as the marker widens (e.g. task checkboxes at 0.6.1).
- Non-first prose children carry no such style.
