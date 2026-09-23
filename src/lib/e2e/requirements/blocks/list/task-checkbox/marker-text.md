# Block: List, Task Checkbox (the text after the marker)

A task marker starts the item's first paragraph (GFM task lists), so whatever follows it on that
line is paragraph text: `- [ ] # note` is a to-do reading `# note`, not a heading with a box.
Later lines of the item still open blocks as they do in any list item.

## Happy paths

- a loaded `- [ ] # adwada` in live mode shows one box and the text `# adwada` beside it, with no
  heading styling, and the tree reloads to the same shape.
  - Miss-analysis: every task fixture put plain prose after the marker, so nothing loaded a line
    whose text after `[ ] ` would open a block, and the item parser read it as a heading.
- clicking the box of such an item flips `[ ]` to `[x]` and leaves the text alone.

## User interactions

- typing at the end of a loaded `- [ ] # beta` keeps the marker and the `#`: `- [ ] # betaX`.
  - Miss-analysis: every scenario described a write that had just changed the first block's
    kind, so nothing described an item that arrived from the parser with `#` after its marker.
- `#t`, Backspace, space in an empty to-do leaves `- [ ] # ` with its box and no heading.
- `# ` typed at the start of a to-do's text leaves `- [ ] # beta` with its box and no heading,
  and the tree reloads to the same shape.
  - Miss-analysis: a write into a task paragraph read its new text on its own, where `# ` opens a
    heading, so the live tree dropped the box while the bytes reloaded as a to-do; the parser
    tests never typed, and the typing tests never compared against a reload.
- Enter inside `- [ ] # adwada` leaves `- [ ] # ad` above `- [ ] wada`, and Enter before the `#`
  of `- [ ] ab# cd` leaves `- [ ] ab` above `- [ ] # cd`: each half is text beside its box, no
  heading, and the tree reloads to the same shape.
  - Miss-analysis: the task-aware reader reached typed writes and merges but not the list split,
    and the shape property keeps list-item bodies out of its split gesture, so no test split a
    to-do whose text would open a block on its own.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
