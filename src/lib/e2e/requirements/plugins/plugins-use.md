# Feature: turning a plugin off in a running editor

## Happy paths

- type in three places, turn latex off, then press Ctrl/Cmd+Z three times: each press gives back the bytes before one of the three edits, newest first
- turning latex off keeps every byte of the document and reads the `$$x^2$$` line as prose

## Edge cases

- an undo step from before the switch puts its bytes back read the way the editor reads now: the `$x^2$` line stays prose after all three undos, and no block is drawn raw

## User interactions

- each edit is a click at the end of a paragraph, then typing; the undo presses are real key presses, with the plugin switch the one call made through the test bridge
