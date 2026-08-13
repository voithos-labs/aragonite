# Feature: Typing a block-math fence into existence

`$$…$$` needs an opening fence and a closing one on separate lines, which Enter alone can never
produce: it always mints a blank-line-separated pair, because two adjacent prose lines are one
paragraph. The latex plugin registers an Enter completer for it, the plugin-surface twin of the
built-in table registrant: a paragraph whose whole raw is `$$`, with the caret at its end, is
replaced by the finished fence pair instead of split.

## Happy paths

- Type `$$` into an empty paragraph and press Enter: the block becomes one math block whose source
  is the fence pair around a single empty line, and the press mints nothing else
- The caret lands ON that empty body line, proven by typing an expression, blurring so the revealed
  source commits, and reading the document bytes

## Edge cases

- One Mod+Z restores the paragraph byte-for-byte with the caret back at the end of the typed fence;
  a character typed after the undo lands after the second `$`, not in front of it
- `$$ x` falls through to the ordinary split: an opener line carrying body text implies no
  multi-line form, so it is not a gesture toward the pair
- Without the latex plugin installed, `$$` plus Enter splits exactly as bare GFM does — the
  completer is gated on registration like every other part of the extension

## Presentation modes

- Live mode: the same press mints the same block and the typed expression lands in its body
- Reading mode: Enter changes nothing; the paragraph's bytes are untouched

## Miss-analysis

No test could have caught this: the completion registry had exactly one registrant, a built-in, so
nothing exercised a completer arriving from the plugin surface — including the fact that a claim's
caret was minted before the seam picked its line ending, which only a caret on a line past the
first can observe. The generalized answer is that a registry with a single built-in registrant has
never been tested as a registry, and its published contract is the untested half.
