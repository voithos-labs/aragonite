# Feature: Image deletion and type-replace

## Happy paths

- Backspace at right boundary enters selected state (no delete)
- Backspace while selected deletes the entire widget source bytes
- Delete at left boundary enters selected state
- Delete while selected deletes
- Type single character while selected replaces widget with character
- Paste markdown image source while selected replaces with new widget

## Edge cases

- Undo restores the deleted widget
