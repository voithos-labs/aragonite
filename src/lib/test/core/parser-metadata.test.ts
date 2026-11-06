import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import type {
	HeadingMetadata,
	FencedCodeMetadata,
	ThematicBreakMetadata,
	BlockquoteMetadata,
	ListMetadata,
	ListItemMetadata
} from '../../core/nodes';

// Per-block metadata extraction only; the structural edge cases live in
// parser-structure.test.ts.

describe('metadata: headings', () => {
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
	it('does not match footnote definitions', () => {
		const doc = parse('[^1]: Footnote content.\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
	});

	it('rejects label-only with no following content', () => {
		const doc = parse('[ref]:\n');
		expect(doc.children[0].kind).not.toBe('linkReferenceDefinition');
	});
});
