# Block: List, Task Checkbox (the item cycled to a heading)

A task marker belongs to the item's first paragraph (GFM task lists): `- [ ] # note` is a task
whose text reads `# note`. A command that turns that paragraph into another kind of block
cannot keep the marker, so the checkbox goes with the paragraph it belonged to. Typing `# ` into
a to-do is text, not a command; `marker-text.md` covers it.

## Happy paths

- `Mod+1` (the heading picker, `runCommand('heading.cycle')`) on a task item's paragraph makes
  the item a bullet holding a heading: `- [ ] beta` → `- # beta`. The checkbox goes with the
  paragraph it belonged to rather than staying to paint `# beta` as literal prose behind a box.
  - Miss-analysis: the checkbox specs drove a to-do whose first block stays a paragraph and the
    heading specs drove headings outside a list, so the pair (a command run on a to-do's
    paragraph) sat between two suites and belonged to neither.
- one `Mod+Z` puts the checkbox and the paragraph back together: dropping the marker joins the
  heading write's undo entry.

## Edge cases

- a second paragraph of a task item cycles on its own; the first paragraph still carries the
  marker, so the checkbox stays.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
