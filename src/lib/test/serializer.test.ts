import { describe, it, expect } from 'vitest';
import { splitLines } from '../core/lines';
import { serialize } from '../core/serializer';
import { Document, Heading, Paragraph, ThematicBreak, List, ListItem } from '../core/nodes';
import { parse } from '../core/parser';

describe('splitLines', () => {
	it('splits LF lines and preserves endings', () => {
		const lines = splitLines('a\nb\nc\n');
		expect(lines).toEqual([
			{ raw: 'a\n', text: 'a', lineEnding: '\n', start: 0, end: 2 },
			{ raw: 'b\n', text: 'b', lineEnding: '\n', start: 2, end: 4 },
			{ raw: 'c\n', text: 'c', lineEnding: '\n', start: 4, end: 6 }
		]);
	});

	it('splits CRLF lines and preserves endings', () => {
		const lines = splitLines('a\r\nb\r\n');
		expect(lines).toEqual([
			{ raw: 'a\r\n', text: 'a', lineEnding: '\r\n', start: 0, end: 3 },
			{ raw: 'b\r\n', text: 'b', lineEnding: '\r\n', start: 3, end: 6 }
		]);
	});

	it('handles final line without trailing newline', () => {
		const lines = splitLines('a\nb');
		expect(lines).toEqual([
			{ raw: 'a\n', text: 'a', lineEnding: '\n', start: 0, end: 2 },
			{ raw: 'b', text: 'b', lineEnding: '', start: 2, end: 3 }
		]);
	});

	it('handles empty string', () => {
		const lines = splitLines('');
		expect(lines).toEqual([]);
	});

	it('handles single line no newline', () => {
		const lines = splitLines('hello');
		expect(lines).toEqual([{ raw: 'hello', text: 'hello', lineEnding: '', start: 0, end: 5 }]);
	});
});

describe('serialize', () => {
	it('serializes an empty document', () => {
		const doc = new Document('', [], '');
		expect(serialize(doc)).toBe('');
	});

	it('serializes a document with prefix and suffix', () => {
		const doc = new Document('\n\n', [new Heading('', '# Title\n', { level: 1 })], '\n');
		expect(serialize(doc)).toBe('\n\n# Title\n\n');
	});

	it('serializes multiple blocks with leading trivia', () => {
		const doc = new Document(
			'',
			[
				new Heading('', '# Title\n', { level: 1 }),
				new Paragraph('\n', 'Some text.\n'),
				new ThematicBreak('\n', '---\n', { marker: '-' })
			],
			''
		);
		expect(serialize(doc)).toBe('# Title\n\nSome text.\n\n---\n');
	});
});

describe('round-trip: leaf blocks', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'single heading', source: '# Hello\n' },
		{
			name: 'heading levels',
			source: '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n'
		},
		{ name: 'heading with no trailing newline', source: '# Hello' },
		{ name: 'paragraph', source: 'Hello world.\n' },
		{ name: 'multi-line paragraph', source: 'Line one.\nLine two.\nLine three.\n' },
		{ name: 'heading then paragraph', source: '# Title\n\nSome body text.\n' },
		{ name: 'fenced code backticks', source: '```js\nconsole.log(1);\n```\n' },
		{ name: 'fenced code tildes', source: '~~~\ncode\n~~~\n' },
		{ name: 'fenced code 4 backticks', source: '````\ncode with ``` inside\n````\n' },
		{ name: 'unclosed fenced code', source: '```\ncode\nmore code\n' },
		{ name: 'thematic break ---', source: '---\n' },
		{ name: 'thematic break ***', source: '***\n' },
		{ name: 'thematic break ___', source: '___\n' },
		{ name: 'thematic break spaced', source: '- - -\n' },
		{ name: 'empty document', source: '' },
		{ name: 'only blank lines', source: '\n\n\n' },
		{ name: 'leading blank lines', source: '\n\n# Title\n' },
		{ name: 'trailing blank lines', source: '# Title\n\n\n' },
		{ name: 'multiple blank lines between blocks', source: '# A\n\n\n\n# B\n' },
		{ name: 'CRLF line endings', source: '# Title\r\n\r\nParagraph.\r\n' },
		{
			name: 'mixed content',
			source: '# Title\n\nParagraph text.\n\n```\ncode\n```\n\n---\n\nMore text.\n'
		}
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});

describe('round-trip: blockquotes', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'simple blockquote', source: '> Hello\n' },
		{ name: 'multi-line blockquote', source: '> Line 1\n> Line 2\n' },
		{ name: 'blockquote with heading', source: '> # Title\n' },
		{ name: 'blockquote with paragraph', source: '> Some text\n> continues here.\n' },
		{ name: 'blockquote then paragraph', source: '> Quote\n\nParagraph.\n' },
		{ name: 'nested blockquote', source: '> > Nested\n' },
		{ name: 'blockquote with blank inner line', source: '> \n> Content\n' },
		{ name: 'blockquote with code block', source: '> ```\n> code\n> ```\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('parses blockquote as Blockquote node', () => {
		const doc = parse('> Hello\n');
		expect(doc.children[0].kind).toBe('blockquote');
	});
});

describe('round-trip: lists', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'unordered single item', source: '- Item\n' },
		{ name: 'unordered multiple items', source: '- A\n- B\n- C\n' },
		{ name: 'ordered list', source: '1. First\n2. Second\n' },
		{ name: 'ordered with paren', source: '1) A\n2) B\n' },
		{ name: 'task list', source: '- [ ] Todo\n- [x] Done\n' },
		{ name: 'plus marker', source: '+ Item\n' },
		{ name: 'star marker', source: '* Item\n' },
		{ name: 'list then paragraph', source: '- Item\n\nParagraph.\n' },
		{ name: 'multi-digit ordered', source: '10. Tenth\n11. Eleventh\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('parses list as List node with ListItem children', () => {
		const doc = parse('- A\n- B\n');
		expect(doc.children[0].kind).toBe('list');
		const list = doc.children[0] as List;
		expect(list.children.length).toBe(2);
		expect(list.children[0].kind).toBe('listItem');
		expect(list.children[1].kind).toBe('listItem');
	});
});

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

describe('round-trip: setext headings', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'setext H1', source: 'Title\n===\n' },
		{ name: 'setext H2', source: 'Title\n---\n' },
		{ name: 'setext H1 long underline', source: 'Title\n==========\n' },
		{ name: 'setext H2 short underline', source: 'Title\n--\n' },
		{ name: 'setext with multi-line content', source: 'Line one\nLine two\n---\n' },
		{ name: 'setext then paragraph', source: 'Title\n===\n\nBody text.\n' },
		{ name: 'setext H1 after blank lines', source: '\nTitle\n===\n' },
		{ name: 'setext H2 trailing space on underline', source: 'Title\n--- \n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('parses setext H1 as SetextHeading node', () => {
		const doc = parse('Title\n===\n');
		expect(doc.children[0].kind).toBe('setextHeading');
	});
});

describe('round-trip: indented code blocks', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'single line', source: '    code line\n' },
		{ name: 'multiple lines', source: '    line 1\n    line 2\n' },
		{ name: 'tab indented', source: '\tcode line\n' },
		{ name: 'mixed indent', source: '    line 1\n\tline 2\n' },
		{ name: 'with blank line inside', source: '    line 1\n\n    line 2\n' },
		{ name: 'after paragraph', source: 'Paragraph.\n\n    code\n' },
		{ name: 'before paragraph', source: '    code\n\nParagraph.\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('parses indented code as IndentedCode node', () => {
		const doc = parse('    code\n');
		expect(doc.children[0].kind).toBe('indentedCode');
	});

	it('indented continuation stays inside paragraph', () => {
		const doc = parse('Paragraph\n    indented line\n');
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('paragraph');
	});
});
