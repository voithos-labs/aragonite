# Feature: Cross-container clipboard operations

## Happy paths
- Cut with anchor inside blockquote and focus outside: deletes range, start wins
- Cut with anchor outside and focus inside blockquote: deletes range, start wins
- Copy across container boundary collects text from both containers

## Edge cases
- Cross-container cut then undo restores both container structure and content
- Backspace across container boundary merges into the start block's context
