# Feature: Gap-mint gesture reachability (note-taking simulation)

Self-tests for the one structural insert the corruption checks could not otherwise
see: a paragraph created at a caret between two blocks. That boundary belongs to no
block's editable area, so no other gesture commits through that path, and a separator
bug there would hide exactly where nothing looks. Each drives the gesture on a fixed
document and asserts a real paragraph landed at the boundary, so an arrival that
quietly entered the block below can never pass as coverage inside a full session.
These run on their own (no `runSession`): the gesture needs a fixture whose
neighbouring kinds declare the facing edges, which a note may never grow.

The gesture arrives by Backspace at the following block's offset 0 (a real key, and
the fallback an eligible boundary intercepts), then types one character or presses
Enter. Both halves are asserted: the gap must be live before the key, and gone after
it, since focusing the new block is what ends it.

## Happy paths

- typing at a `table | fencedCode` boundary inserts a paragraph carrying the character
  between the two blocks, with the blank-line separators GFM requires on both sides
- Enter at the same boundary inserts an empty paragraph and lands the caret in it, so
  the next character types into the new block rather than creating a second one

## Error cases

- a boundary neither neighbour declares (`paragraph | fencedCode`) fails loudly: the
  Backspace merges as usual, and recording that as an insert would be coverage for
  nothing
- the structural sweep (container parity, nested state, round-trip, selection validity)
  holds after each insert

## User interactions

- the arrival is a real click into the following block followed by a real Backspace;
  the insert is a real keystroke. Nothing is placed programmatically
- the gap position is read through the test bridge, which is assertion rather than
  interaction, since the gap is not a `SelectionPoint` and no selection query can see it
