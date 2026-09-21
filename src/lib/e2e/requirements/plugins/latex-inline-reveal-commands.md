# Feature: block commands while an inline source is shown

While a widget shows its editable `$…$` bytes, that edit lives in DOM the tree has never seen. Every block command (merge, split, hard break, heading cycle, format toggle) reads `node.raw`, so a command that fires in that state has to commit the shown source first and then run against the committed bytes, using the caret and selection it read before that commit, since committing puts the caret somewhere of its own.

The rule lives where a block dispatches its commands, so it holds for every kind that can show its source: inline math, footnote references and inline directive text, and all three are driven here. What Enter does is a separate concern (`latex-inline-reveal-enter.md`).

## Happy paths

- Backspace-merging a block whose shown source was deleted character by character merges the now empty block, and the deleted math does not come back in the merged bytes
- The same merge with an edited but still valid shown source (`$x^2$` becoming `$x^2q$`) merges the edited bytes: the edit is neither lost nor replaced by the source from before it, which is what rules out a broken construct as the trigger
- Mod+1 cycles the heading on the committed bytes, keeping an edit the tree had not been told about
- Mod+B toggles the range the user selected: committing puts down a caret that collapses the live selection, so the command has to act on the range it read before committing rather than read one again afterwards
- A footnote reference and an inline directive-text widget, the other two kinds with `revealSource: true`, take the same merge with no code of their own
- The emptied block takes its own blank line with it, so the merged bytes reload as the blocks on screen; the widget kind has no say in that, and neither does the kind after it

## Miss-analysis

- Deriving the blank lines changed what merging an emptied middle block leaves behind, and this spec pinned the shape that was retired (`above` / blank / blank / definition), which reloaded one block wider than the live tree. The sweep that landed the rule picked its e2e projects from the files it touched, so `e2e-plugins` never ran; the honest rule is to pick them from the behavior that changed, because a change to how separators are derived in `tree-operations` reaches every spec asserting `getSource()` after Backspace, Enter or a delete, whether or not its fixture mentions a blank line. The tree-level pin for the family is `test/tree-operations/emptied-block-collapse.test.ts`.

- The caret restored after a commit lands inside the formula that was just closed, and a restore that shows a formula closing around a typed byte must not read that as a reason to open it again; the invariant message on the commands above is what caught the reopen, since the command then ran with a source open once more

## Edge cases

- ArrowRight leaves a block whose edited source sits at its end, committing on the way: the live bytes are shorter than `node.raw`, and a boundary test against the stale raw traps the caret in the block forever
- Backspace with the caret mid-source still edits the shown source the way the browser does, because the merge command declines at any non-zero offset, so editing the shown source is untouched
- Escape still cancels and discards the edit that never reached the tree

## Error cases

- No `[invariant:…]` message and no page error while a structural command runs against a block whose source is shown
