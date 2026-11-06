# Feature: turning a plugin off in a running editor

## Happy paths

- type in three places, turn latex off, then press Ctrl/Cmd+Z three times: each press gives back the bytes before one of the three edits, newest first, and the `$$` block reads as prose the whole way
- turning latex off keeps every byte of the document: the `$$x^2$$` line stays in the source as it was

## User interactions

- each edit is a click at the end of a paragraph, then typing; the undo presses are real key presses, with the plugin switch the one call made through the test bridge
