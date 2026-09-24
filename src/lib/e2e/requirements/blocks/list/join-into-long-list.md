# Feature: joining a paragraph into the last item of a long list

A list long enough that only part of it is drawn, then a paragraph after a blank line. A gesture that moves the paragraph into the list's last item must leave the caret in the joined text, so the next key lands there, in source and live mode.

## Happy paths

- Two spaces typed at the start of `zz` under a 150-item list: the paragraph joins the last item, and the next key lands before `zz` (regression: the caret vanished and the key was lost; miss-analysis: every join test used a list short enough to be drawn whole, so a caret placement that never waited for the joined block to be drawn could not fail)
- The same two spaces pasted: the same join, and the next key lands before `zz`
- Four spaces typed: the paragraph joins at the second space and keeps the other two, and the next key lands before `zz`

## Edge cases

- Backspace at the start of `zz`: the paragraph joins the last item's text (`- item 149zz`), and the next key lands at the join (regression: the caret was lost on some runs; miss-analysis: the same as above, where the Backspace join puts the caret)
