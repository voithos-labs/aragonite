# Feature: A last line erased to nothing

Backspace through a block's last line leaves its line break standing and the caret on the empty line after it; the next key belongs on that line.

## Edge cases

- `Plan\nmore\n`, End on `more`, Backspace four times, then `x`: the source is `Plan\nx\n` in source mode (regression: `Planx\n\n`, the key landed before the break; miss-analysis: the plain-text and code blocks give the empty last line a caret anchor, and no prose test typed on a line its own text left empty)
- The same keys in live mode: `Plan\nx\n`
- `Plan\nmore\n\nnext\n`, End on `more`, Backspace four times: the source is `Plan\n\nnext\n`, the emptied line stays `Plan`'s and `next` reloads as the second of two blocks (regression #632: `Plan\n\n\nnext\n`, which reloads with a blank block nobody typed; miss-analysis: every erase test emptied a block with nothing below it, so no row had a blank line under the erased one)
- One more Backspace after that: still `Plan\n\nnext\n`, the blank line goes back to separating `next`, which stays a paragraph of its own
- The same keys in live mode
- `Plan\n\nmore` with no final line break, End on `more`, Backspace four times, then `x`: `Plan\n\n\n`, then `Plan\n\nx\n`, in source and live mode; the emptied line is a blank last line and keeps its break (regression: `Plan\n\n`, then `Plan\nx\n`, the letter joined the paragraph above; miss-analysis: every erase row's fixture ended in a line break, so no row emptied a block on a last line that had none)
- `> Plan\n>\n> more` with no final line break, the same keys: `> Plan\n>\n>\n`, then `> Plan\n>\n> x\n`, in source and live mode (regression: `> Plan\n> x\n`, joined inside the quote)
- With no final line break, a block's second line `pq` emptied by Backspace twice, by Shift+ArrowLeft twice then Delete, or by a word delete, then `x`: the file ends as the same file with a final line break does, in source and live mode. A paragraph `above\npq` gives `above\n\n`, then `above\nx\n`; a list item `- one\n- two\n  pq` gives `- one\n- two\n  \n`, then `- one\n- two\n  x\n`; an unclosed code block (a fence line, then `pq`) keeps an empty body line and its break, then `x` on that line; a quote `> above\n> pq` gives `> above\n>\n`, then `> above\n> x\n` (regression: the emptied line's break went, and `x` joined the line above: `abovex`, `- twox`, `> abovex`, and on the fence line as its info string; miss-analysis: the open-file rows emptied whole paragraphs only, so no row emptied a line under a block's other lines, where the commit read that line's break as the file's final one)
- Each of those rows with a final line break: the same bytes, the control
- An unclosed code block ending in `pq` with no final line break, Enter at the end of `pq`, then `x`: an empty body line under `pq` with its break, then `x` on it and a break after, in source and live mode (regression: the Enter wrote nothing and `x` joined `pq`; the same cause as the rows above)
- `Plan\n===\n\nb\n` in source mode, End on the underline, Backspace three times: `Plan\n\nb\n`, two paragraphs that reload as two (the #632 report's own keys)
