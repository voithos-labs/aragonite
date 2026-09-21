# Feature: typing at whole-block focus mints a paragraph below

A `blockFocus: 'whole-block'` kind (thematic break here; mermaid pinned in
plugins/mermaid-focus) is its own focus target, so it holds no caret and a typed character
has nowhere to land. Rather than drop it, the shared whole-block key handling creates a paragraph
below the block carrying that character, caret after it: the same thing a printable does at a gap
caret, one undo entry and one insert event, beside the Enter that already splits below.

Chords keep their own routes: only a bare printable (no Ctrl/Meta/Alt) creates the paragraph, and
reading mode consumes the keypress without changing anything, exactly as the Enter branch does.

Fixture: `Before` / `---` / `After`, so the break has an editable neighbour on each side.

## Happy paths

- Focused thematic break, type `x` then `y`: a paragraph `xy` sits between the rule and
  `After`, and the second character proves the caret landed after the first
- Focused thematic break, press Space: the paragraph is created for a space too, and the rule
  itself is unchanged

## Edge cases

- One Mod+Z afterwards restores the source from before byte-exactly: the new paragraph is a single
  undo entry, not a paragraph insert plus a separate typing entry
- Mod+C while the block is focused creates nothing: the copy chord keeps its route

## Error / mode cases

- Reading mode: a printable at whole-block focus leaves the document byte-unchanged

## Miss-analysis

- No scenario ever sent a printable to a whole-block-focused block: coverage of the shared
  key handling stopped at Enter, Backspace/Delete, the arrow exits and the Mod+C/Mod+X chords,
  so the one key class with no branch at all was also the one class no test pressed
