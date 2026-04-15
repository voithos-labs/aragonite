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
	TableMetadata
} from '../../core/nodes';

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

	it('parses --- after paragraph as setext H2, not thematic break', () => {
		const doc = parse('Title\n---\n');
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('setextHeading');
	});
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

	// CommonMark §5.1: a blockquote paragraph may continue onto a line
	// without `>` as long as the line is not itself a new block opener
	// and the blockquote's current inner block is an open paragraph.
	it('absorbs a lazy continuation line into an open paragraph', () => {
		const doc = parse('> First line\nlazy continuation\n');
		expect(doc.children).toHaveLength(1);
		const bq = doc.children[0];
		expect(bq.kind).toBe('blockquote');
		expect(bq.children).toHaveLength(1);
		const para = bq.children![0];
		expect(para.kind).toBe('paragraph');
		expect(para.raw).toContain('First line');
		expect(para.raw).toContain('lazy continuation');
	});

	it('lazy continuation absorbs multiple consecutive non-> lines', () => {
		const doc = parse('> A\nB\nC\n');
		const bq = doc.children[0];
		expect(bq.kind).toBe('blockquote');
		expect(bq.children).toHaveLength(1);
		expect(bq.children![0].kind).toBe('paragraph');
		expect(bq.children![0].raw).toBe('A\nB\nC\n');
	});

	it('lazy continuation stops at a blank line', () => {
		const doc = parse('> inside\nlazy\n\nafter\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('blockquote');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('after\n');
	});

	it('lazy continuation does not absorb a new block opener', () => {
		// `# heading` is a block opener, so it ends the blockquote rather
		// than lazy-continuing the paragraph.
		const doc = parse('> quoted\n# heading\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('blockquote');
		expect(doc.children[1].kind).toBe('heading');
	});

	it('lazy continuation preserves round-trip', () => {
		const source = '> First line\nlazy continuation\n';
		const doc = parse(source);
		expect(serialize(doc)).toBe(source);
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

	it('extracts list item markers', () => {
		const doc = parse('+ Item\n');
		const list = doc.children[0];
		expect((list.children![0].metadata as ListItemMetadata).marker).toBe('+ ');
	});
});

describe('metadata: nested lists', () => {
	it('nested unordered list produces list inside list item', () => {
		const doc = parse('- Item\n  - Nested\n');
		expect(doc.children).toHaveLength(1);
		const list = doc.children[0];
		expect(list.kind).toBe('list');
		expect(list.children).toHaveLength(1);
		const item = list.children![0];
		expect(item.kind).toBe('listItem');
		// Item has two children: paragraph "Item" and nested list
		expect(item.children).toHaveLength(2);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![1].kind).toBe('list');
		// Nested list has one item
		const nested = item.children![1];
		expect(nested.children).toHaveLength(1);
		expect(nested.children![0].kind).toBe('listItem');
	});

	it('continuation line merges into item paragraph', () => {
		const doc = parse('- Line 1\n  Line 2\n');
		const list = doc.children[0];
		const item = list.children![0];
		expect(item.children).toHaveLength(1);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![0].raw).toBe('Line 1\nLine 2\n');
	});

	it('multi-paragraph item has multiple children', () => {
		const doc = parse('- Para 1\n\n  Para 2\n');
		const list = doc.children[0];
		const item = list.children![0];
		expect(item.children).toHaveLength(2);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![1].kind).toBe('paragraph');
	});

	it('ordered list with continuation preserves marker', () => {
		const doc = parse('1. Item\n   more\n');
		const list = doc.children[0];
		expect((list.metadata as { ordered: boolean }).ordered).toBe(true);
		const item = list.children![0];
		expect((item.metadata as { marker: string }).marker).toBe('1. ');
	});

	it('task item preserves checkbox in inner content', () => {
		const doc = parse('- [x] Done\n');
		const list = doc.children[0];
		const item = list.children![0];
		expect((item.metadata as { taskItem: boolean }).taskItem).toBe(true);
		expect((item.metadata as { taskChecked: boolean }).taskChecked).toBe(true);
		expect(item.children).toHaveLength(1);
		expect(item.children![0].raw).toBe('[x] Done\n');
	});

	it('deeply nested list', () => {
		const doc = parse('- L1\n  - L2\n    - L3\n');
		const l1List = doc.children[0];
		const l1Item = l1List.children![0];
		// L1 item has paragraph "L1" and nested list
		const l2List = l1Item.children!.find((c) => c.kind === 'list');
		expect(l2List).toBeDefined();
		const l2Item = l2List!.children![0];
		const l3List = l2Item.children!.find((c) => c.kind === 'list');
		expect(l3List).toBeDefined();
		expect(l3List!.children![0].kind).toBe('listItem');
	});
});

// ── Edge Case Structural Tests ──────────────────────────────────────────────

describe('structural: headings', () => {
	it('7 hashes is a paragraph, not a heading', () => {
		const doc = parse('####### Not a heading\n');
		expect(doc.children[0].kind).toBe('paragraph');
	});

	it('empty heading is still a heading', () => {
		const doc = parse('#\n');
		expect(doc.children[0].kind).toBe('heading');
		expect((doc.children[0].metadata as HeadingMetadata).level).toBe(1);
	});
});

describe('structural: document prefix/suffix', () => {
	it('captures leading blank lines as prefix', () => {
		const doc = parse('\n\n# Title\n');
		expect(doc.prefix).toBe('\n\n');
		expect(doc.children.length).toBe(1);
	});

	it('captures trailing blank lines as suffix', () => {
		const doc = parse('# Title\n\n\n');
		expect(doc.suffix).toBe('\n\n');
		expect(doc.children.length).toBe(1);
	});

	it('empty document has empty prefix/suffix', () => {
		const doc = parse('');
		expect(doc.prefix).toBe('');
		expect(doc.suffix).toBe('');
		expect(doc.children.length).toBe(0);
	});

	it('only blank lines go into prefix', () => {
		const doc = parse('\n\n\n');
		expect(doc.prefix).toBe('\n\n\n');
		expect(doc.children.length).toBe(0);
		expect(doc.suffix).toBe('');
	});
});

describe('structural: blockquote children', () => {
	it('blockquote containing a list has list children', () => {
		const doc = parse('> - A\n> - B\n');
		const bq = doc.children[0];
		expect(bq.kind).toBe('blockquote');
		expect(bq.children!.length).toBeGreaterThan(0);
		expect(bq.children![0].kind).toBe('list');
	});

	it('blockquote innerPrefix/innerSuffix are strings', () => {
		const doc = parse('> # Title\n');
		const bq = doc.children[0];
		expect(typeof bq.innerPrefix).toBe('string');
		expect(typeof bq.innerSuffix).toBe('string');
	});
});

describe('structural: mixed list types', () => {
	it('adjacent different list types produce separate blocks', () => {
		const doc = parse('- A\n\n1. B\n');
		expect(doc.children.length).toBe(2);
		expect(doc.children[0].kind).toBe('list');
		expect((doc.children[0].metadata as ListMetadata).ordered).toBe(false);
		expect(doc.children[1].kind).toBe('list');
		expect((doc.children[1].metadata as ListMetadata).ordered).toBe(true);
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
});

describe('metadata: tables', () => {
	it('extracts column count', () => {
		const doc = parse('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		const node = doc.children[0];
		expect(node.kind).toBe('table');
		expect((node.metadata as TableMetadata).columnCount).toBe(3);
	});
});
