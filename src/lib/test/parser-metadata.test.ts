import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';

describe('metadata: headings', () => {
	it('extracts heading levels 1-6', () => {
		for (let level = 1; level <= 6; level++) {
			const doc = parse(`${'#'.repeat(level)} Title\n`);
			const node = doc.children[0];
			expect(node.kind).toBe('heading');
			expect(node.metadata.level).toBe(level);
		}
	});

	it('handles indented heading', () => {
		const doc = parse('  ## Title\n');
		const node = doc.children[0];
		expect(node.kind).toBe('heading');
		expect(node.metadata.level).toBe(2);
	});
});

describe('metadata: fenced code', () => {
	it('extracts backtick fence info', () => {
		const doc = parse('```typescript\ncode\n```\n');
		const node = doc.children[0];
		expect(node.kind).toBe('fencedCode');
		expect(node.metadata.fenceMarker).toBe('`');
		expect(node.metadata.fenceLength).toBe(3);
		expect(node.metadata.info).toBe('typescript');
		expect(node.metadata.closed).toBe(true);
	});

	it('extracts tilde fence', () => {
		const doc = parse('~~~~\ncode\n~~~~\n');
		const node = doc.children[0];
		expect(node.metadata.fenceMarker).toBe('~');
		expect(node.metadata.fenceLength).toBe(4);
		expect(node.metadata.closed).toBe(true);
	});

	it('detects unclosed fence', () => {
		const doc = parse('```\ncode\n');
		const node = doc.children[0];
		expect(node.metadata.closed).toBe(false);
	});

	it('requires close fence to have at least as many chars', () => {
		const doc = parse('````\n```\ncode\n````\n');
		const node = doc.children[0];
		expect(node.metadata.closed).toBe(true);
		expect(node.metadata.fenceLength).toBe(4);
	});
});

describe('metadata: thematic breaks', () => {
	it('identifies dash marker', () => {
		const doc = parse('---\n');
		const node = doc.children[0];
		expect(node.kind).toBe('thematicBreak');
		expect(node.metadata.marker).toBe('-');
	});

	it('identifies asterisk marker', () => {
		const doc = parse('***\n');
		const node = doc.children[0];
		expect(node.metadata.marker).toBe('*');
	});

	it('identifies underscore marker', () => {
		const doc = parse('___\n');
		const node = doc.children[0];
		expect(node.metadata.marker).toBe('_');
	});

	it('parses --- after paragraph as setext H2, not thematic break', () => {
		const doc = parse('Title\n---\n');
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('setextHeading');
	});
});

describe('metadata: setext headings', () => {
	it('identifies setext H1 with ===', () => {
		const doc = parse('Title\n===\n');
		const node = doc.children[0];
		expect(node.kind).toBe('setextHeading');
		expect(node.metadata.level).toBe(1);
	});

	it('identifies setext H2 with ---', () => {
		const doc = parse('Title\n---\n');
		const node = doc.children[0];
		expect(node.kind).toBe('setextHeading');
		expect(node.metadata.level).toBe(2);
	});
});

describe('metadata: blockquotes', () => {
	it('extracts quote depth', () => {
		const doc = parse('> Hello\n');
		const node = doc.children[0];
		expect(node.kind).toBe('blockquote');
		expect(node.metadata.quoteDepth).toBe(1);
	});

	it('has children', () => {
		const doc = parse('> # Title\n');
		const node = doc.children[0];
		expect(node.children.length).toBeGreaterThan(0);
		expect(node.children[0].kind).toBe('heading');
	});
});

describe('metadata: lists', () => {
	it('identifies unordered list', () => {
		const doc = parse('- A\n- B\n');
		const node = doc.children[0];
		expect(node.kind).toBe('list');
		expect(node.metadata.ordered).toBe(false);
	});

	it('identifies ordered list', () => {
		const doc = parse('1. A\n2. B\n');
		const node = doc.children[0];
		expect(node.metadata.ordered).toBe(true);
	});

	it('identifies task items', () => {
		const doc = parse('- [ ] Todo\n- [x] Done\n');
		const list = doc.children[0];
		const items = list.children!;
		expect(items[0].metadata.taskItem).toBe(true);
		expect(items[0].metadata.taskChecked).toBe(false);
		expect(items[1].metadata.taskItem).toBe(true);
		expect(items[1].metadata.taskChecked).toBe(true);
	});

	it('extracts list item markers', () => {
		const doc = parse('+ Item\n');
		const list = doc.children[0];
		expect(list.children[0].metadata.marker).toBe('+');
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
		expect((doc.children[0]).metadata.level).toBe(1);
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
		expect(bq.children.length).toBeGreaterThan(0);
		expect(bq.children[0].kind).toBe('list');
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
		expect((doc.children[0]).metadata.ordered).toBe(false);
		expect(doc.children[1].kind).toBe('list');
		expect((doc.children[1]).metadata.ordered).toBe(true);
	});
});

describe('metadata: link reference definitions', () => {
	it('extracts label', () => {
		const doc = parse('[my-ref]: https://example.com\n');
		const node = doc.children[0];
		expect(node.kind).toBe('linkReferenceDefinition');
		expect(node.metadata.label).toBe('my-ref');
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
		expect(node.metadata.columnCount).toBe(3);
	});
});
