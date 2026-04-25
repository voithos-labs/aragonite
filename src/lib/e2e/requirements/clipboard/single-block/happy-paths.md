# Feature: Single-block clipboard — happy paths

## Happy paths

- Select text via Shift+Arrow then Ctrl+C, move cursor, Ctrl+V: text duplicates
- Select text then Ctrl+X: text removed and on clipboard
- Select text then Ctrl+V: replaces selection with clipboard content
- Select text then type characters: replaces selection with typed text
