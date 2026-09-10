# Feature: inline delimiters close themselves as they are typed

A lone `$` or backtick typed into prose pairs with whatever matching delimiter comes later on the
line, so a formula or code span already there lent its closer to the new opener and the prose
between them was wrapped. The keystroke now lands the delimiter's twin after the caret, the way an
IDE closes a quote, so the new opener always has its own closer. The built-in backtick behaves this
way on its own; a plugin trigger opts in with `autoPair: true` on `registerInlineSyntax`.

## Happy paths

- `$` typed ahead of an existing `$x^2$`: the source gains `$$` at the caret and the formula keeps
  its own delimiters.
- Letters typed between the twins land inside them; the formula's source opens around the caret
  (the math widget does not form under it and push it aside).
- The closer typed over the twin steps past it and writes nothing; the next byte lands outside the
  construct. In live mode the closer is unpainted, so only the caret's side moves (the typing seat
  writes the byte through the CST).
- A backtick pairs the same way, and the closing press steps over the hidden closer.

## The empty pair

- A first body byte that makes the pair no construct drops the twin: `$5` is a price, `$ ` a shell
  prompt, so neither keeps a stray `$` after it. A backtick keeps its twin for any byte, since
  `` `1` `` is code.
- Backspace between the twins takes both.

## Block openers

- Three backticks are still three keystrokes: the second steps over the twin, the third extends
  the run, and the line is a fence.
- `$$` is still two keystrokes and still forms the math block as the second lands: a step-over
  that leaves the line an on-type completer claims goes through the content door so the completer
  is consulted.

## Declines

- A delimiter typed directly in front of another span's opener inserts literally: it is spelling
  something out, not opening a span.
- Nothing pairs over a selection, inside a composition, or in a revealed formula's source (there
  only the step-over past the live closer applies, and it folds the reveal).
