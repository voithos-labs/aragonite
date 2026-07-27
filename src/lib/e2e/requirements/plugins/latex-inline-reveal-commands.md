# Feature: The fold seam — block commands against a revealed inline source

While a reveal-source widget shows its editable `$…$` bytes, the edit is ephemeral DOM the CST has not seen. Every block command — merge, split, hard break, heading cycle, format toggle — reads `node.raw`, so a command that fires in that state must fold the reveal first and run against the committed bytes, at the caret and selection it read BEFORE the fold (the fold parks its own caret).

The rule lives at the block's command seam, so it holds for every reveal-capable widget kind — inline math, footnote references, inline directive text — and each of the three is driven here. Enter's own contract is a separate concern (`latex-inline-reveal-enter.md`).

## Happy paths

- Backspace-merging a block whose revealed source was deleted character by character merges the EMPTY block — the deleted math does not reappear in the merged bytes
- The same merge with an edited but still-valid revealed source (`$x^2$` → `$x^2q$`) merges the EDITED bytes — neither the edit is lost nor the pre-edit source resurrected, which is what rules out construct-breakage as the trigger
- Mod+1 cycles the heading on the committed bytes, keeping an edit the CST had not been told about
- Mod+B toggles the range the user selected: the fold parks a caret that collapses the live selection, so the command must act on the range it read before folding, not re-read one after
- A footnote reference and an inline directive-text widget — the other two `revealSource: true` kinds — take the same merge with no code of their own

## Edge cases

- ArrowRight leaves a block whose EDITED reveal sits at its end (and commits on the way): the live bytes are shorter than `node.raw`, and a boundary test against the stale raw traps the caret in the block forever
- Backspace with the caret mid-source still edits the revealed source natively — the merge command declines at a non-zero offset, so reveal editing is untouched
- Escape still cancels the reveal and discards the ephemeral edit

## Error cases

- No `[invariant:…]` fire and no page error while a structural command runs against a revealed block
