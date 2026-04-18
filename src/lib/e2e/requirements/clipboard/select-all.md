# Feature: Select-all clipboard round-trip

## Happy paths

- Ctrl+A twice → Ctrl+C → paste into new block reproduces document content
- Ctrl+A twice → Ctrl+X → removes all content, leaving single empty block

## Edge cases

- Select-all copy on single-block document: paste appends entire block content
- Select-all then paste replaces entire document with clipboard content
