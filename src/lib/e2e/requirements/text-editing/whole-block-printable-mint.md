# Feature: typing at whole-block focus mints a paragraph below

A `blockFocus: 'whole-block'` kind (thematic break here; mermaid pinned in
plugins/mermaid-focus) IS its own focus target, so it hosts no caret and a typed character
has nowhere to land. Rather than drop it, the shared whole-block key tail mints a paragraph
below the block carrying that character, caret after it — the gap caret's printable mint,
one undo entry and one insert event, beside the Enter that already splits below.

Chords keep their own routes: only a bare printable (no Ctrl/Meta/Alt) mints, and reading
mode consumes the press without mutating, exactly as the Enter branch does.

Fixture: `Before` / `---` / `After`, so the break has an editable neighbour on each side.

## Happy paths

- Focused thematic break, type `x` then `y`: a paragraph `xy` sits between the rule and
  `After` — the second character proves the caret landed after the first
- Focused thematic break, press Space: the mint happens for a space too, and the rule
  itself is unchanged

## Edge cases

- One Mod+Z after the mint restores the pre-mint source byte-exactly: the mint is a single
  undo entry, not a paragraph insert plus a separate typing entry
- Mod+C while the block is focused mints nothing — the copy chord keeps its route

## Error / mode cases

- Reading mode: a printable at whole-block focus leaves the document byte-unchanged

## Miss-analysis

- No scenario ever sent a printable to a whole-block-focused block: coverage of the shared
  key tail stopped at Enter, Backspace/Delete, the arrow exits and the Mod+C/Mod+X chords,
  so the one key class with no branch at all was also the one class no test pressed
