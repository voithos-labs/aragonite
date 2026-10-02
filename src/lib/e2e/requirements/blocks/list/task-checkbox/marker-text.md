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

- pasting two paragraphs right after `# b` in `- [ ] # bc` leaves `- [ ] # b` with its box and
  no heading, the pasted text below it, and the tree reloads to the same shape (#666).
  - Miss-analysis: the paste re-read the text left before the cut on its own, where `# b` opens a
    heading, and the paste suites only ever split plain paragraphs and plain items.
- pasting a list right after `# b` in `- [ ] # bc` splits the to-do around it: `- [ ] # b`, the
  pasted items, then `- [ ] c`, each half text beside its box (#666). A list takes a different
  route from paragraphs (it splits the item), so it gets a row of its own.

- pasting `# x` at the very start of `- [ ] bc` lands the heading the clipboard held, with `bc`
  below it, and the tree reloads to the same shape. (The checkbox goes, as it does for any
  block that isn't a paragraph; #624 is where that gets decided for every route.)
  - Miss-analysis: every paste row left text before the cut, so no single pasted block landed at a
    to-do's text start, where its re-read took the to-do's reader and split one line into two.
- Enter and a typed letter in the item below a loaded `- [ ] |b|` over a delimiter row land
  cleanly, with no invariant fire: that to-do holds a table, which is what its reload reads too.
  - Miss-analysis: the checkbox check stood in for the reload with "a to-do holds a paragraph
    first", which the parser's own reading of this shape breaks, and no fixture loaded it.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
