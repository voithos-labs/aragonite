# Feature: Inline Editing, the Pair the Auto-Pair Wrote

The auto-pair steps over, collapses or deletes only the empty pair it wrote itself, and it keeps
that pair its own while the user types inside it. Two delimiters it never wrote as a pair are the
user's bytes, and a key between them touches only its own byte.

## Edge cases

- `**b` typed after `a `, then the caret moved between the two leading stars and a space typed,
  writes `a * *b**` (regression: `a * b**`, one star gone)
  - Miss-analysis: the empty-pair rows only ever held a pair the auto-pair had just written, and
    no case moved the caret into a doubled delimiter the user had typed and pressed a key there.
- `__b` typed the same way, with a space between the underscores, writes `a _ _b__`
  (regression: `a _ b__`)
- Backspace between the two leading stars of a typed `**b` takes one star, `a *b**`
  (regression: `a b**`, both taken)

## Happy paths

- `*b` typed, then Backspace twice: the second Backspace takes both stars of the pair emptied
  again, since typing inside the pair keeps it the auto-pair's
