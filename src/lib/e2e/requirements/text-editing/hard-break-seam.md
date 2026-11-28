# Feature: a hard break where Enter would split

Shift+Enter cuts where Enter would cut at the same caret: at the end of a line with a soft line
break after it, the hard break takes that line break's place, and past a bold or a link that ends
at the caret, so the closer stays on its line. Every row types a letter after the break.

Miss-analysis: every hard-break row broke mid-line, and none broke at the end of a line a soft line
break follows, the one place Enter's cut takes a byte.

## Happy paths

- `one` then `two` on the next line, the caret at the end of `one` (End), Shift+Enter, then `x`:
  `one\` then `xtwo`, one paragraph, in source and live mode.
- `*oneo*` then `two`, live mode, the caret at the end of `oneo` (End), Shift+Enter, then `x`:
  `*oneo*\` then `xtwo`, the emphasis closed on its own line.
- `[oneo](u)` then `two`, live mode, the same: `[oneo](u)\` then `xtwo`.

## Edge cases

- `*oneo*` then `two`, live mode, the caret inside `oneo`, Shift+Enter, then `x`: the break goes in
  at the caret, the emphasis spanning it.
