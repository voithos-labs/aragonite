# Feature: inline delimiters close themselves as they are typed

A lone `$` or backtick typed into prose used to pair with whatever matching delimiter came later
on the line, so a formula or code span already there lent its closer to the new opener and the
prose between them got wrapped. The keystroke now lands the matching delimiter after the caret,
the way an editor closes a quote, so a new opener always has its own closer. The built-in
backtick does this on its own; a plugin trigger opts in with `autoPair: true` on
`registerInlineSyntax`.

## Happy paths

- `$` typed ahead of an existing `$x^2$`: the source gains `$$` at the caret and the formula
  keeps its own delimiters.
- Letters typed between the two land inside them, and the formula's source opens around the
  caret, so the math widget does not form under it and push it aside.
- Typing the closer where one is already there steps past it and writes nothing, and the next
  byte lands outside the construct. In live mode that closer is not painted, so only the caret's
  side moves; the code that places typed bytes writes them through the tree.
- A backtick pairs the same way, and typing the closer steps over the hidden one.

## The emphasis family

- `*` and `_` pair one at a time (`*|*`), and a second press inside the pair grows it to `**|**`
  rather than stepping over, since a double run is the next construct up. Neither pairs directly
  after a word byte (`2*3`, `snake_case`).
- `~` pairs only as a double run: a single tilde is nothing in GFM, so `~5 minutes` has to stay
  prose, and `~|` plus `~` gives `~~|~~`.
- Typing the closing delimiter inside a closing run steps over it byte by byte, and the byte
  after the run lands outside the construct (a run that is not painted moves the caret's side,
  not the caret).

## The empty pair

- A first body byte that makes the pair no construct at all drops the second delimiter: `$5` is
  a price and `$ ` a shell prompt, so neither keeps a stray `$` after it. A backtick keeps its
  pair for any byte, since `` `1` `` is code.
- Backspace between the two takes both.
- Only a pair the auto-pair wrote is dropped this way. `$$b` typed after `pay ` steps over the
  partner and then types `b`, so a space typed between the two dollars afterwards writes
  `pay $ $b` (regression: `pay $ b`, one dollar gone).

## Block openers

- Three backticks are still three keystrokes: the second steps over the one already there, the
  third extends the run, and the line is a fence.
- `$$` is still two keystrokes and still forms the math block as the second one lands: a step
  over that leaves the line to an on-type completer goes through the one content-writing path,
  so the completer is asked.

## Declines

- A delimiter typed directly in front of another span's opener is inserted literally: it is
  spelling something out, not opening a span.
- Nothing pairs over a selection, inside a composition, or inside a formula's shown source,
  where only the step over the live closer applies, and that closes the shown source.
