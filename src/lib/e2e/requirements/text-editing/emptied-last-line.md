# Feature: A last line erased to nothing

Backspace through a block's last line leaves its line break standing and the caret on the empty line after it; the next key belongs on that line.

## Edge cases

- `Plan\nmore\n`, End on `more`, Backspace four times, then `x`: the source is `Plan\nx\n` in source mode (regression: `Planx\n\n`, the key landed before the break; miss-analysis: the plain-text and code blocks give the empty last line a caret anchor, and no prose test typed on a line its own text left empty)
- The same keys in live mode: `Plan\nx\n`
