# Code Style Guide

## Formatting

Prettier handles all formatting. Run `npm run format` before committing.

See `.prettierrc` for the full config. Indentation is tabs (four spaces wide).

## File Structure

### File Header

Each source file starts with a brief comment describing its purpose when the filename alone isn't sufficient:

```ts
/**
 * Flat-string text buffer with line indexing for the editor core.
 */
```

Skip the header when the filename is self-explanatory (e.g., `nodes.ts` in a well-scoped directory).

### Section Dividers

Use divider comments to separate logical sections within a file:

```ts
// ── Section Name ────────────────────────────────────────────────────────────
```

Use these for grouping related items: interfaces, classes, helper functions, etc. Don't over-divide — a section should contain multiple related items, not wrap a single function.

## Comments

### When to Write Inline Comments

- **Non-obvious "why"**: When the reason for a choice isn't clear from context. Explain _why_, not _what_.
- **Workarounds**: When code works around a bug, spec ambiguity, or platform quirk. Link to the issue if one exists.
- **Deliberate exclusions**: When something is intentionally left out and a future reader might try to "fix" it by adding it back.

```ts
// Thematic breaks are deliberately excluded here. A `---` line does NOT
// interrupt a paragraph from inside the continuation scan.
```

### When NOT to Write Comments

- Don't describe what the code does when the code is readable
- Don't add JSDoc to every function — only when the signature doesn't tell the full story
- Don't add `@param` / `@returns` when the types already communicate this

### Function-Level Comments

Use a brief JSDoc comment when:

- The function is part of a public API
- The behavior has non-obvious edge cases
- The function name alone doesn't convey what it returns or its side effects

```ts
/**
 * Parse a raw file string into { frontmatter, body }.
 * Returns null frontmatter if the file has no YAML header.
 */
static deserialize(raw: string): { frontmatter: DocumentFrontmatter | null; body: string }
```
