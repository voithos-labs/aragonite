/**
 * Comprehensive markdown document for E2E testing.
 * Covers all GFM block types and inline syntax.
 */
export const DEFAULT_CONTENT = `# Heading 1

## Heading 2

### Heading 3

A paragraph with **bold text**, *italic text*, ~~strikethrough~~, and \`inline code\`.

Another paragraph with a [link](https://example.com) and plain text.

---

> A blockquote paragraph.
>
> Second blockquote paragraph with **bold**.

- Item one
- Item two
  - Nested item
- Item three

1. First
2. Second
3. Third

\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`

A final paragraph.
`;

/**
 * Simple content for tests that need a minimal starting state.
 */
export const SIMPLE_CONTENT = `First paragraph.

Second paragraph.

Third paragraph.
`;
