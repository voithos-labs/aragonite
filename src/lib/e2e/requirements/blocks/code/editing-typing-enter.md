# Feature: Code Block Typing + Enter

Typing and Enter behavior inside fenced code blocks (textarea-based editing surface).

## Happy paths

- typing inside code block updates source: click into code block, type text, source reflects the change
- Enter creates newline inside code block: Enter inserts a newline, does not split into a new block
- Enter at end of a closed fence places caret on the new body line: typed text after the Enter lands on the new line, not on the previous line
- Enter at end of an unclosed fence adds a body line and caret lands on it: typed text follows the Enter on the new line (regression for the trailing-newline Chromium quirk)
- Enter mid-line splits at the cursor: cursor between two characters of a body line, Enter moves the trailing portion (and the caret) to a new line
- code block content round-trips: editing then checking getSource() produces valid fenced code

## Edge cases

- typing at the body start (caret at the end of the opener line's `\n`): the char lands in the body, not the opener — pins the Chromium insertText mis-route against the fence-line wrapper (the opener `\n` moved inside `.md-fence-line`)
