# Feature: live-mode joins under a list marker

When a live cut strands a delimiter run, the join cleanup drops it, so the joined text carries no
`**` the user never saw. Under a list marker that cleanup used to say no every single time, so a
delete, a cut or typing over a selection in a list item's first line left the runs on screen.
The contract: a live cut in a list item's first line writes the same text a cut at the top level
writes, and a reload of the document reads back the tree the edit left. Driven on `/test/editor`
with `?presentationMode=live`. Every scenario checks the source, since a hidden delimiter and a
missing one look the same on screen.

## Happy paths

- in a list item, a selection from inside bold to inside italic, deleted with Backspace, leaves
  the joined text with neither `**` nor `*` in the source, and the reload agrees with the tree
- the same selection typed over puts the character where the two sides now meet
- the same selection cut with `Mod+X` leaves the same bytes
- in a to-do item the same Backspace cleans up the same way, and the checkbox stays
- a selection from inside a construct in one item into the next item joins the two, and the
  run it cut off goes with it

## Edge cases

- Backspace right after the only letter of a bold word at an item's start takes the letter and
  the pair it emptied; the space left in front of the text widens the marker, which is how a
  reload reads it anyway, and no `**` shows

## User interactions

- Real clicks, arrow steps and `Shift+Arrow` extends only: the cleanup runs in the keydown and
  `beforeinput` handlers, and a programmatic selection never fires those
- Cut is a real `Mod+X`

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss-analysis

The join's check read the list marker off a field the parse result doesn't have, so it refused
every candidate under a marker. Every live join scenario ran in a top-level paragraph, and the
fuzzer counted any refusal as no worse than the literal edit, so nothing went red.
