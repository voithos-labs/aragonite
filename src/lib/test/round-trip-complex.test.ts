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
		{ name: 'heading with closing hashes', source: '## Title ##\n' },
		{ name: 'heading with trailing spaces', source: '# Title   \n' },
		{ name: 'empty heading', source: '#\n' },
		{ name: 'empty heading with space', source: '# \n' },
		{ name: '7 hashes is not a heading', source: '####### Not a heading\n' },

		{ name: 'fence with trailing space on opener', source: '```  \ncode\n```\n' },
		{ name: 'fence with empty content', source: '```\n```\n' },
		{ name: 'tilde fence close must match character', source: '```\ncode\n~~~\nmore code\n```\n' },

		{ name: 'blockquote no space after >', source: '>text\n' },
		{ name: 'blockquote containing a list', source: '> - A\n> - B\n' },
		{ name: 'blockquote containing thematic break', source: '> ---\n' },

		{ name: 'list item with empty content', source: '- \n' },
		{ name: 'mixed list types are separate lists', source: '- A\n\n1. B\n' },
		{ name: 'list item with special chars', source: '- Item with `code` and *emphasis*\n' },

		{ name: 'single newline only', source: '\n' },
		{ name: 'single character no newline', source: 'x' },
		{ name: 'spaces only line', source: '   \n' },

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

// ── Ambiguity edge cases: what a construct is NOT ───────────────────────────

describe('construct-boundary edge cases', () => {
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

	it('round-trips setext inside blockquote', () => {
		const source = '> Title\n> ---\n';
		const doc = parse(source);
		expect(serialize(doc)).toBe(source);
	});

	it('round-trips indented code at document start', () => {
		const source = '    code at start\n';
		const doc = parse(source);
		expect(serialize(doc)).toBe(source);
		expect(doc.children[0].kind).toBe('indentedCode');
	});

	it('round-trips HTML block after heading with no blank line', () => {
		const source = '# Title\n<div>\nContent\n</div>\n';
		const doc = parse(source);
		expect(serialize(doc)).toBe(source);
	});

	it('delimiter row alone is not a table', () => {
		const doc = parse('| --- | --- |\n');
		expect(doc.children[0].kind).not.toBe('table');
	});

	it('round-trips table immediately after heading', () => {
		const source = '# Title\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
		const doc = parse(source);
		expect(serialize(doc)).toBe(source);
	});

	it('link ref def at document start', () => {
		const doc = parse('[ref]: https://example.com\n');
		expect(doc.children[0].kind).toBe('linkReferenceDefinition');
	});

	it('footnote definition is not a link ref def', () => {
		const doc = parse('[^1]: Footnote content.\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
	});

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

// ── Reference-Style Links and Images ────────────────────────────────────────

describe('round-trip: reference-style links and images', () => {
	const cases: { name: string; source: string }[] = [
		{
			name: 'full reference link',
			source: 'Click [here][go] now.\n\n[go]: https://example.com\n'
		},
		{
			name: 'collapsed reference link',
			source: 'See [Click Here][] today.\n\n[click here]: https://example.com\n'
		},
		{
			name: 'shortcut reference link',
			source: 'See [example] today.\n\n[example]: https://example.com\n'
		},
		{
			name: 'reference link with title',
			source: '[click][go]\n\n[go]: https://example.com "Go"\n'
		},
		{
			name: 'reference image',
			source: '![pic][img]\n\n[img]: /img.png "Alt"\n'
		},
		{
			name: 'reference link inside emphasis',
			source: '*see [click][go] now*\n\n[go]: https://example.com\n'
		},
		{
			name: 'multi-LRD doc with mixed references',
			source: '[a][one] and [b][two].\n\n[one]: https://1.com\n[two]: https://2.com\n'
		},
		{
			name: 'unresolved reference (no matching LRD)',
			source: '[broken][missing] text.\n'
		},
		{
			name: 'reference link mixed with inline link',
			source: '[ref][go] vs [inline](https://x.com).\n\n[go]: https://example.com\n'
		}
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
