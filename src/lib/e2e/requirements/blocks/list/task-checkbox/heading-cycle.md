# Block: List — Task Checkbox (the item cycled to a heading)

A task marker belongs to the item's first PARAGRAPH (GFM § 5.3): `- [ ] # note` is a task whose
text reads `# note` on GitHub. This editor parses the bytes after the marker as blocks, so a
first block that stops being a paragraph cannot keep the marker: `Mod+1` on a to-do, or `# `
typed into one, used to mint a heading inside a task item — an h1 line with a checkbox scaled to
it. Now the checkbox goes with the paragraph it belonged to.

## Happy paths

- `Mod+1` (the heading picker, `runCommand('heading.cycle')`) on a task item's paragraph makes
  the item a bullet holding a heading: `- [ ] beta` → `- # beta`. The checkbox goes with the
  paragraph it belonged to rather than staying to paint `# beta` as literal prose behind a box.
  - Miss-analysis: the checkbox specs drove a to-do whose first block stays a paragraph and the
    heading specs drove headings outside a list, so the pair (a command run on a to-do's
    paragraph) sat between two suites and belonged to neither.
- one `Mod+Z` puts the checkbox and the paragraph back together: the marker drop joins the
  heading write's undo entry.

## Edge cases

- a second paragraph of a task item cycles on its own; the first paragraph still carries the
  marker, so the checkbox stays.
- a document loaded with `- [ ] # beta` keeps those bytes while it is edited: nothing the user
  did took the paragraph away, so typing into the heading may not rewrite the marker out of the
  source. Only the write that re-kinds the first block gives the checkbox up.
  - Miss-analysis: every reconcile scenario described a write that had just re-kinded the first
    block, so nothing described an item that arrived from the parser already holding a heading,
    and a rule keyed on the child's kind alone read the two states the same.
- `# ` typed at the start of a to-do is the same road by keyboard: the paragraph re-kinds to a
  heading and the box goes with it (`- # beta`).
- the bare `#` on the way to `#tag` keeps the box: it is a heading to the parser for one
  keystroke, and taking the box then would strip a to-do for typing a tag into it. `#t` is a
  paragraph again, box intact.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
