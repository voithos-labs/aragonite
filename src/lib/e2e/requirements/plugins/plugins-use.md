# Feature: turning a plugin off in a running editor

## Happy paths

- type in three places, turn latex off, then press Ctrl/Cmd+Z three times: each press gives back the bytes before one of the three edits, newest first, and the `$$` block reads as prose the whole way
- turning latex off keeps every byte of the document: the `$$x^2$$` line stays in the source as it was

## Edge cases

- until undo entries remember the grammar they were parsed under (D2), an undo step from before the switch restores the math block it held, drawn raw with a `block-host` warning; the spec claims that warning, so it reds once the restore reparses

## User interactions

- each edit is a click at the end of a paragraph, then typing; the undo presses are real key presses, with the plugin switch the one call made through the test bridge
