# Editor Roadmap

## 0.4 — Cross-Block Selection & Clipboard

### Cross-Block Selection

- `EditorSelection` model with anchor/focus positions across blocks
- Custom selection rendering: overlays via `Range` + `getClientRects()`
- Shift+click and Shift+arrow to extend selection across blocks
- Click-and-drag across block boundaries
- Double Ctrl+A: first selects within block, second selects entire document
- Non-text blocks in selection range get full-block highlight

### Cross-Block Clipboard

- Cross-block copy: extract text from anchor block through focus block, preserving leading trivia
- Cross-block cut: copy, then truncate anchor/focus blocks and remove middle blocks, merge remainders
- Cross-block paste: delete selection, parse pasted text as CST, splice into document
- Cross-block delete: same as cut without clipboard write

## 0.5 — Polish & Enhancement

- Drag-and-drop block reordering
- Block toolbar / hover handles
- Keyboard shortcuts for block type transformation (Ctrl+1 for H1, etc.)
- Syntax styling refinement (dimmed markers, colored syntax)
- Search and replace

## Future Considerations

### CST Phase 3 — Structured Fields

The ownership flip (inline tree becomes authoritative, `raw` derived from it) and block-level structured fields. This would enable semantic editing (toggle bold by wrapping in Strong node) and optional syntax hiding (Obsidian-style markers hidden on unfocus).

**Deferred.** The costs are significant — round-trip preservation becomes fragile (serializer must reproduce original delimiter styles), partial/broken syntax during typing has no clean tree representation, and both target features can be approximated by manipulating `raw` directly. The editor's "always-visible styled source" design is fully served by CST Phase 2. Revisit when there's a concrete need that raw manipulation can't satisfy.

### Other

- Incremental parsing (optimization — full re-parse on every edit is fine for now)
- Blockquote unwrap on Backspace at start of first child
- List item unindent on Backspace
- Custom block extensions (callouts, embedded queries)
