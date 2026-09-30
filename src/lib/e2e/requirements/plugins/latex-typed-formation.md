# Feature: Typing a block-math fence into existence

`$$…$$` needs an opening fence and a closing one on separate lines, which Enter alone can never
produce: it always makes a pair separated by a blank line, because two prose lines next to each
other are one paragraph. The latex plugin registers an Enter completer for it, the plugin-side
counterpart of the built-in table's: a paragraph whose whole raw text is `$$`, with the caret at
its end, is replaced by the finished fence pair instead of being split.

## Happy paths

- Type `$$` into an empty paragraph: the block becomes one math block as the second `$` lands,
  with no Enter, the way a typed ``` is a fence at once, whose source is the fence pair around a
  single empty line, with the caret on that line
- A lone `$$` line that was loaded rather than typed, plus Enter, creates the same block: the
  Enter handler stays for a line the as-you-type handler never saw typed
- `$$` typed after other text on the line stays prose: only a line that is nothing but `$$`
  opens anything
- The caret lands on that empty body line, proven by typing an expression, blurring so the shown
  source commits, and reading the document bytes

## Edge cases

- The new block puts the caret inside a render-primary leaf, which commits on blur, so the undo
  entry only closes once the caret leaves: after the blur, one Mod+Z restores the paragraph byte
  for byte with the caret back at the end of the typed fence, and a character typed then lands
  after the second `$` rather than in front of it. Mod+Z from inside the source while it is
  still focused does nothing (#161), which is a gap between showing a source and undo rather
  than one in the completion, since the same entry restores correctly after the blur
- A loaded `$$ x` plus Enter falls through to the ordinary split: an opener line carrying body
  text implies no multi-line form, so it is not a gesture toward the pair
- Without the latex plugin installed, `$$` plus Enter splits exactly as plain GFM does, because
  the completer only exists once the plugin registers, like every other part of the extension

## Presentation modes

- Live mode: the same keypress creates the same block and the typed expression lands in its body
- Reading mode: Enter changes nothing, the paragraph's bytes are untouched, and the same
  keypress completes once the mode is lifted, which is what proves the key reached the editor
  and was declined

## Miss-analysis

No test could have caught this: the completion registry had exactly one registrant, a built-in,
so nothing exercised a completer arriving from a plugin, including the fact that the caret for a
completion was created before the code picked its line ending, which only a caret on a line past
the first can notice. The general answer is that a registry with a single built-in registrant has
never been tested as a registry, and its published contract is the half nobody tested.
