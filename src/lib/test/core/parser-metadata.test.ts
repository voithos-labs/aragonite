import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import type {
	HeadingMetadata,
	SetextHeadingMetadata,
	FencedCodeMetadata,
	ThematicBreakMetadata,
	BlockquoteMetadata,
	ListMetadata,
	ListItemMetadata,
	LinkReferenceDefinitionMetadata,
	TableMetadata,
	TableRowMetadata
} from '../../core/nodes';

// Per-block metadata extraction only; the structural edge cases live in
// parser-structure.test.ts.

describe('metadata: headings', () => {
	for (let level = 1; level <= 6; level++) {
		it(`extracts heading level ${level}`, () => {
			const doc = parse(`${'#'.repeat(level)} Title\n`);
			const node = doc.children[0];
			expect(node.kind).toBe('heading');
			expect((node.metadata as HeadingMetadata).level).toBe(level);
		});
	}

	it('handles indented heading', () => {
		const doc = parse('  ## Title\n');
		const node = doc.children[0];
		expect(node.kind).toBe('heading');
		expect((node.metadata as HeadingMetadata).level).toBe(2);
	});
});

describe('metadata: fenced code', () => {
	it('extracts backtick fence info', () => {
		const doc = parse('```typescript\ncode\n```\n');
		const node = doc.children[0];
		expect(node.kind).toBe('fencedCode');
		expect((node.metadata as FencedCodeMetadata).fenceMarker).toBe('`');
		expect((node.metadata as FencedCodeMetadata).fenceLength).toBe(3);
		expect((node.metadata as FencedCodeMetadata).info).toBe('typescript');
		expect((node.metadata as FencedCodeMetadata).closed).toBe(true);
	});

	it('extracts tilde fence', () => {
		const doc = parse('~~~~\ncode\n~~~~\n');
		const node = doc.children[0];
		expect((node.metadata as FencedCodeMetadata).fenceMarker).toBe('~');
		expect((node.metadata as FencedCodeMetadata).fenceLength).toBe(4);
		expect((node.metadata as FencedCodeMetadata).closed).toBe(true);
	});

	it('detects unclosed fence', () => {
		const doc = parse('```\ncode\n');
		const node = doc.children[0];
		expect((node.metadata as FencedCodeMetadata).closed).toBe(false);
	});

	it('requires close fence to have at least as many chars', () => {
		const doc = parse('````\n```\ncode\n````\n');
		const node = doc.children[0];
		expect((node.metadata as FencedCodeMetadata).closed).toBe(true);
		expect((node.metadata as FencedCodeMetadata).fenceLength).toBe(4);
	});
});

describe('metadata: thematic breaks', () => {
	const markers: [string, string][] = [
		['---', '-'],
		['***', '*'],
		['___', '_']
	];

	for (const [source, marker] of markers) {
		it(`identifies ${marker} marker`, () => {
			const doc = parse(`${source}\n`);
			const node = doc.children[0];
			expect(node.kind).toBe('thematicBreak');
			expect((node.metadata as ThematicBreakMetadata).marker).toBe(marker);
		});
	}
});

describe('metadata: setext headings', () => {
	const cases: [string, string, number][] = [
		['===', 'setext H1', 1],
		['---', 'setext H2', 2]
	];

	for (const [underline, label, level] of cases) {
		it(`identifies ${label} with ${underline}`, () => {
			const doc = parse(`Title\n${underline}\n`);
			const node = doc.children[0];
			expect(node.kind).toBe('setextHeading');
			expect((node.metadata as SetextHeadingMetadata).level).toBe(level);
		});
	}
});

describe('metadata: blockquotes', () => {
	it('extracts quote depth', () => {
		const doc = parse('> Hello\n');
		const node = doc.children[0];
		expect(node.kind).toBe('blockquote');
		expect((node.metadata as BlockquoteMetadata).quoteDepth).toBe(1);
	});

	it('has children', () => {
		const doc = parse('> # Title\n');
		const node = doc.children[0];
		expect(node.children!.length).toBeGreaterThan(0);
		expect(node.children![0].kind).toBe('heading');
	});
});

describe('metadata: lists', () => {
	it('identifies unordered list', () => {
		const doc = parse('- A\n- B\n');
		const node = doc.children[0];
		expect(node.kind).toBe('list');
		expect((node.metadata as ListMetadata).ordered).toBe(false);
	});

	it('identifies ordered list', () => {
		const doc = parse('1. A\n2. B\n');
		const node = doc.children[0];
		expect((node.metadata as ListMetadata).ordered).toBe(true);
	});

	it('identifies task items', () => {
		const doc = parse('- [ ] Todo\n- [x] Done\n');
		const list = doc.children[0];
		const items = list.children!;
		expect((items[0].metadata as ListItemMetadata).taskItem).toBe(true);
		expect((items[0].metadata as ListItemMetadata).taskChecked).toBe(false);
		expect((items[1].metadata as ListItemMetadata).taskItem).toBe(true);
		expect((items[1].metadata as ListItemMetadata).taskChecked).toBe(true);
	});

	it('populates taskMarker with the parsed source fragment', () => {
		const doc = parse('- [x] task\n');
		const list = doc.children[0];
		const item = list.children![0];
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskChecked).toBe(true);
		expect(meta.taskMarker).toBe('[x] ');
	});

	it('preserves uppercase X in taskMarker', () => {
		const doc = parse('- [X] task\n');
		const item = doc.children[0].children![0];
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskMarker).toBe('[X] ');
	});

	it('preserves multi-space whitespace in taskMarker', () => {
		const doc = parse('- [x]  task\n');
		const item = doc.children[0].children![0];
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskMarker).toBe('[x]  ');
	});

	it('taskMarker is null for non-task list items', () => {
		const doc = parse('- plain item\n');
		const item = doc.children[0].children![0];
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
		expect(meta.taskMarker).toBeNull();
	});

	it('strips taskMarker from the first paragraph raw', () => {
		const doc = parse('- [x] task content\n');
		const item = doc.children[0].children![0];
		const firstChild = item.children![0];
		expect(firstChild.kind).toBe('paragraph');
		expect(firstChild.raw).toBe('task content\n');
	});

	it('strips uppercase variant from first paragraph raw', () => {
		const doc = parse('- [X] uppercase\n');
		const firstChild = doc.children[0].children![0].children![0];
		expect(firstChild.raw).toBe('uppercase\n');
	});

	it('extracts list item markers', () => {
		const doc = parse('+ Item\n');
		const list = doc.children[0];
		expect((list.children![0].metadata as ListItemMetadata).marker).toBe('+ ');
	});

	it('ordered list with continuation preserves marker', () => {
		const doc = parse('1. Item\n   more\n');
		const list = doc.children[0];
		expect((list.metadata as ListMetadata).ordered).toBe(true);
		const item = list.children![0];
		expect((item.metadata as ListItemMetadata).marker).toBe('1. ');
	});
});

describe('metadata: link reference definitions', () => {
	it('extracts label', () => {
		const doc = parse('[my-ref]: https://example.com\n');
		const node = doc.children[0];
		expect(node.kind).toBe('linkReferenceDefinition');
		expect((node.metadata as LinkReferenceDefinitionMetadata).label).toBe('my-ref');
	});

	it('does not match footnote definitions', () => {
		const doc = parse('[^1]: Footnote content.\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
	});

	const cases: Array<{
		name: string;
		source: string;
		label: string;
		url?: string;
		title?: string;
	}> = [
		{
			name: 'single-line url only',
			source: '[ref]: http://example.com\n',
			label: 'ref',
			url: 'http://example.com'
		},
		{
			name: 'single-line url + title',
			source: '[ref]: http://example.com "title"\n',
			label: 'ref',
			url: 'http://example.com',
			title: 'title'
		},
		{
			name: 'url on continuation line',
			source: '[ref]:\n  http://example.com\n',
			label: 'ref',
			url: 'http://example.com'
		},
		{
			name: 'url + title on continuation lines',
			source: '[ref]:\n  http://example.com\n  "title"\n',
			label: 'ref',
			url: 'http://example.com',
			title: 'title'
		},
		{
			name: 'url inline + title on continuation',
			source: '[ref]: http://example.com\n  "title"\n',
			label: 'ref',
			url: 'http://example.com',
			title: 'title'
		},
		{
			name: 'angle-bracket url + continuation title',
			source: '[ref]: <http://example.com>\n  "title"\n',
			label: 'ref',
			url: 'http://example.com',
			title: 'title'
		}
	];

	for (const c of cases) {
		it(`parses + round-trips: ${c.name}`, () => {
			const doc = parse(c.source);
			const node = doc.children[0];
			expect(node.kind).toBe('linkReferenceDefinition');
			const meta = node.metadata as LinkReferenceDefinitionMetadata;
			expect(meta.label).toBe(c.label);
			expect(meta.url).toBe(c.url);
			if (c.title !== undefined) expect(meta.title).toBe(c.title);
			else expect(meta.title).toBeUndefined();
			expect(serialize(doc)).toBe(c.source);
			expect(node.raw).toBe(c.source);
		});
	}

	it('rejects label-only with no following content', () => {
		const doc = parse('[ref]:\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
	});

	it('rejects label-only with blank continuation', () => {
		const doc = parse('[ref]:\n\nparagraph\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
	});
});

describe('metadata: tables', () => {
	it('extracts column count and default alignments', () => {
		const doc = parse('| A | B | C |\n| --- | --- | --- |\n');
		const meta = doc.children[0].metadata as TableMetadata;
		expect(meta.columnCount).toBe(3);
		expect(meta.alignments).toEqual(['none', 'none', 'none']);
	});

	it('extracts left/center/right alignments', () => {
		const doc = parse('| A | B | C |\n| :--- | :---: | ---: |\n');
		const meta = doc.children[0].metadata as TableMetadata;
		expect(meta.alignments).toEqual(['left', 'center', 'right']);
	});

	it('produces tableRow children with isHeader on row 0 only', () => {
		const doc = parse('| A |\n| --- |\n| 1 |\n| 2 |\n');
		const rows = doc.children[0].children!;
		expect((rows[0].metadata as TableRowMetadata).isHeader).toBe(true);
		expect((rows[1].metadata as TableRowMetadata).isHeader).toBe(false);
		expect((rows[2].metadata as TableRowMetadata).isHeader).toBe(false);
	});
});
