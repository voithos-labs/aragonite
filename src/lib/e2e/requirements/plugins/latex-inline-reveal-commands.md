# Feature: Block commands against a revealed inline source

While a reveal-source widget shows its editable `$…$` bytes, the edit is ephemeral DOM the CST has not seen. Every block command — split, merge, hard break, heading cycle — reads `node.raw`, so a command that fires in that state must fold the reveal first and run against the committed bytes.

The rule lives at the block's command seam, so it holds for every reveal-capable widget kind (inline math, inline directive text, footnote references), not just latex.

## Happy paths

- Backspace-merging a block whose revealed source was deleted character by character merges the EMPTY block — the deleted math does not reappear in the merged bytes
- The same merge with an edited but still-valid revealed source (`$x^2$` → `$x^2q$`) merges the EDITED bytes — neither the edit is lost nor the pre-edit source resurrected
- A footnote reference (a second reveal-capable kind) obeys the same merge rule, proving the seam is core and not latex-local

## Edge cases

- Backspace with the caret mid-source still edits the revealed source natively — the merge command declines at a non-zero offset, so reveal editing is untouched
- Escape still cancels the reveal and discards the ephemeral edit
- No `[invariant:…]` fire and no page error while a structural command runs against a revealed block
