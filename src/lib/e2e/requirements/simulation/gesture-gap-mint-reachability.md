# Feature: Gap-mint gesture reachability (note-taking simulation)

Reachability self-tests for the structural insert the corruption oracle could not
otherwise see: a paragraph minted at a between-blocks caret. The boundary belongs to
no block's editing surface, so no other gesture commits through that path, and a
separator bug there would hide exactly where nothing looks. Each drives the gesture on
a fixed document and asserts a real paragraph landed AT the boundary, so an arrival
that quietly entered the block below can never pass as coverage inside a full session.
Isolated (no `runSession`): the gesture needs a fixture whose adjacent kinds declare
the facing edges, which a note is not guaranteed to grow.

The gesture arrives by Backspace at the following block's offset 0 (a real key, and the
fallback the eligible boundary now intercepts), then types one character or presses
Enter. Both halves are asserted: the gap must be live before the key, and gone after it,
since it is the mint's own focus of the new block that ends it.

## Happy paths

- typing at a `table | fencedCode` boundary inserts a paragraph carrying the character
  between the two blocks, with the blank-line separators GFM owes on both sides
- Enter at the same boundary inserts an empty paragraph and lands the caret in it, so
  the next character types into the new block rather than minting a second one

## Error cases

- a boundary neither neighbour declares (`paragraph | fencedCode`) fails loudly: the
  Backspace merges as it always did, and recording that as a mint would be coverage for
  nothing
- the structural sweep (container parity, nested state, round-trip, selection validity)
  holds after each mint

## User interactions

- the arrival is a real click into the following block followed by a real Backspace;
  the mint is a real keystroke. Nothing is placed programmatically
- the gap position is read through the test bridge, which is assertion rather than
  interaction, since the gap is not a `SelectionPoint` and no selection query can see it
