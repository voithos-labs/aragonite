# Feature: Block commands against a revealed inline source

While a reveal-source widget shows its editable `$…$` bytes, the edit is ephemeral DOM the CST has not seen. Every block command — split, merge, hard break, heading cycle — reads `node.raw`, so a command that fires in that state must fold the reveal first and run against the committed bytes. Enter is one of those commands: in a prose block it splits like anywhere else, rather than being consumed as a reveal-only commit gesture.

The rule lives at the block's command seam, so it holds for every reveal-capable widget kind (inline math, inline directive text, footnote references), not just latex.

## Happy paths

- Backspace-merging a block whose revealed source was deleted character by character merges the EMPTY block — the deleted math does not reappear in the merged bytes
- The same merge with an edited but still-valid revealed source (`$x^2$` → `$x^2q$`) merges the EDITED bytes — neither the edit is lost nor the pre-edit source resurrected
- Enter at the leading edge of a revealed source splits the block there: the content moves down and the caret stays BEFORE it
- Enter after the revealed source has been broken into plain text splits on the FIRST press
- Enter mid-source commits the ephemeral edit as it splits — the edit is not discarded by the structural op
- Mod+1 cycles the heading on the committed bytes, keeping an edit the CST had not been told about
- Mod+B toggles the range the user selected: the fold parks a caret that collapses the live selection, so the command must act on the range it read before folding, not re-read one after
- A footnote reference (a second reveal-capable kind) obeys the same merge rule, proving the seam is core and not latex-local

## Edge cases

- ArrowRight leaves a block whose EDITED reveal sits at its end (and commits on the way): the live bytes are shorter than `node.raw`, and a boundary test against the stale raw traps the caret in the block forever
- Backspace with the caret mid-source still edits the revealed source natively — the merge command declines at a non-zero offset, so reveal editing is untouched
- A caret snapped past a trailing math widget paints exactly one caret: the synthetic indicator is up and the block's native caret is suppressed (the shared rule lives in `blocks/image/caret-synthetic-indicator.md`)
- Escape still cancels the reveal and discards the ephemeral edit
- No `[invariant:…]` fire and no page error while a structural command runs against a revealed block
