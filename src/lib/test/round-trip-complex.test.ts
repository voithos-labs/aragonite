/**
 * Complex document round-trips and edge case tests.
 * These test interactions between block types and boundary conditions.
 */

import { describe, it, expect } from 'vitest';
import { serialize } from '../core/serializer';
import { parse } from '../core/parser';

// ── Complex Document Round-Trip Tests ───────────────────────────────────────

describe('round-trip: complex documents', () => {
    it('round-trips a project README', () => {
        const source = `# Limestone

A local-first desktop notes app.

## Features

- **Source management** — create and browse note directories
- **Search** — fuzzy title matching with recency weighting
- **Markdown** — full GFM support

## Getting Started

\`\`\`bash
npm install
npm run tauri dev
\`\`\`

> **Note:** You need Rust and Tauri v2 prerequisites installed.

## Roadmap

1. File watcher integration
2. Full-text search via Tantivy
3. Custom markdown editor

---

Built with Tauri 2, SvelteKit, and Rust.
`;
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    it('round-trips a meeting notes document', () => {
        const source = `# Sprint Planning — 2026-03-21

## Action Items

- [x] Review PR #42
- [ ] Deploy staging build
- [ ] Write migration script

## Discussion

> The auth middleware rewrite is driven by compliance, not tech debt.
> We should prioritize correctness over ergonomics.

Key decisions:

1. Freeze merges after Thursday
2. Cut release branch from main
3. Run full regression suite

## Code Snippet

\`\`\`sql
SELECT d.*, s.path
FROM documents d
JOIN sources s ON s.id = d.source_id
WHERE d.deleted_at IS NULL;
\`\`\`

---

Next meeting: Monday 10am.
`;
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    it('round-trips a document with dense block transitions', () => {
        const source = `# Heading
Paragraph right after heading.

> Blockquote
> with continuation

\`\`\`
code block
\`\`\`
- list item one
- list item two

***

## Another heading

> > Nested blockquote

Final paragraph.
`;
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    it('round-trips a document with irregular whitespace', () => {
        const source = `

# Title after two blank lines



Paragraph after three blank lines.


> Quote after two blank lines.

- Item


`;
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    it('round-trips a document with mixed deferred and supported syntax', () => {
        const source = `# API Reference

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/docs | List documents |
| POST | /api/docs | Create document |

### Authentication

All endpoints require a bearer token:

\`\`\`
Authorization: Bearer <token>
\`\`\`

### Response Format

\`\`\`json
{
  "data": [],
  "meta": { "total": 0 }
}
\`\`\`

> [!NOTE]
> Rate limiting applies to all endpoints.

---

See [full docs](https://example.com) for details.
`;
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    it('round-trips a document with CRLF throughout', () => {
        const source =
            '# Title\r\n\r\nParagraph one.\r\nContinuation line.\r\n\r\n' +
            '> Blockquote\r\n> line two\r\n\r\n' +
            '- Item A\r\n- Item B\r\n\r\n' +
            '```js\r\nconsole.log("hello");\r\n```\r\n\r\n' +
            '---\r\n';
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });
});

// ── Edge Case Round-Trip Tests ──────────────────────────────────────────────

describe('round-trip: edge cases', () => {
    const cases: { name: string; source: string }[] = [
        // Heading edge cases
        { name: 'heading with closing hashes', source: '## Title ##\n' },
        { name: 'heading with trailing spaces', source: '# Title   \n' },
        { name: 'empty heading', source: '#\n' },
        { name: 'empty heading with space', source: '# \n' },
        { name: '7 hashes is not a heading', source: '####### Not a heading\n' },

        // Fenced code edge cases
        { name: 'fence with trailing space on opener', source: '```  \ncode\n```\n' },
        { name: 'fence with empty content', source: '```\n```\n' },
        { name: 'tilde fence close must match character', source: '```\ncode\n~~~\nmore code\n```\n' },

        // Blockquote edge cases
        { name: 'blockquote no space after >', source: '>text\n' },
        { name: 'blockquote containing a list', source: '> - A\n> - B\n' },
        { name: 'blockquote containing thematic break', source: '> ---\n' },

        // List edge cases
        { name: 'list item with empty content', source: '- \n' },
        { name: 'mixed list types are separate lists', source: '- A\n\n1. B\n' },
        { name: 'list item with special chars', source: '- Item with `code` and *emphasis*\n' },

        // Whitespace edge cases
        { name: 'single newline only', source: '\n' },
        { name: 'single character no newline', source: 'x' },
        { name: 'spaces only line', source: '   \n' },

        // Block boundary edge cases
        { name: 'blockquote then list no gap', source: '> Quote\n- List\n' },
        { name: 'list then blockquote no gap', source: '- Item\n> Quote\n' },
        { name: 'heading then blockquote no gap', source: '# Title\n> Quote\n' }
    ];

    for (const { name, source } of cases) {
        it(`round-trips: ${name}`, () => {
            const doc = parse(source);
            expect(serialize(doc)).toBe(source);
        });
    }
});

// ── V2 Edge Case Tests ──────────────────────────────────────────────────────

describe('v2 edge cases', () => {
    // Setext vs thematic break disambiguation
    it('--- after blank line is thematic break, not setext', () => {
        const doc = parse('Paragraph.\n\n---\n');
        expect(doc.children.length).toBe(2);
        expect(doc.children[0].kind).toBe('paragraph');
        expect(doc.children[1].kind).toBe('thematicBreak');
    });

    it('--- at document start is thematic break', () => {
        const doc = parse('---\n');
        expect(doc.children[0].kind).toBe('thematicBreak');
    });

    it('=== alone is not a setext heading (no preceding text)', () => {
        const doc = parse('===\n');
        expect(doc.children[0].kind).toBe('paragraph');
    });

    // Setext in containers
    it('round-trips setext inside blockquote', () => {
        const source = '> Title\n> ---\n';
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    // Indented code at document start
    it('round-trips indented code at document start', () => {
        const source = '    code at start\n';
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
        expect(doc.children[0].kind).toBe('indentedCode');
    });

    // HTML block boundaries
    it('round-trips HTML block after heading with no blank line', () => {
        const source = '# Title\n<div>\nContent\n</div>\n';
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    // Table detection edge cases
    it('delimiter row alone is not a table', () => {
        const doc = parse('| --- | --- |\n');
        expect(doc.children[0].kind).not.toBe('table');
    });

    it('round-trips table immediately after heading', () => {
        const source = '# Title\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    // Link ref def edge cases
    it('link ref def at document start', () => {
        const doc = parse('[ref]: https://example.com\n');
        expect(doc.children[0].kind).toBe('linkReferenceDefinition');
    });

    it('footnote definition is not a link ref def', () => {
        const doc = parse('[^1]: Footnote content.\n');
        expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
    });

    // Cross-block round-trips
    it('round-trips setext heading then table', () => {
        const source = 'Title\n===\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    it('round-trips indented code then HTML block', () => {
        const source = '    code\n\n<div>\nhtml\n</div>\n';
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });

    it('round-trips link ref def then setext heading', () => {
        const source = '[ref]: https://example.com\n\nTitle\n---\n';
        const doc = parse(source);
        expect(serialize(doc)).toBe(source);
    });
});
