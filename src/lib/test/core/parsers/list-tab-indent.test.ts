import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins } from '$lib';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';

// A tab in a body's indentation counts to the next multiple of four columns, as CommonMark
// expands it (GH #437; expectations checked against commonmark.js). The document keeps its tab;
// a child holds the columns left over as spaces, so it reads alone as it reads in the body.
// Miss-analysis: every body-membership pin indented with spaces, and the shape property drew tab
// lines only where the space-only count happened to agree, so the count was never contradicted.

beforeAll(() => {
	installPlugins([footnotesPlugin()]);
});

const kinds = (nodes: readonly CstNode[] | undefined) => (nodes ?? []).map((n) => n.kind);

function onlyItem(source: string): CstNode {
	const doc = parse(source);
	expect(serialize(doc)).toBe(source);
	expect(kinds(doc.children)).toEqual(['list']);
	expect(doc.children[0].children).toHaveLength(1);
	return doc.children[0].children![0];
}

describe('a tab-indented line after a list item', () => {
	it.each([
		['after a bare blank line', '- a\n\n\tb\n'],
		['after an indented blank line', '- a\n  \n\tb\n'],
		['with the tab past the content column', '- a\n\n  \tb\n']
	])('%s is a second paragraph of the item', (_, source) => {
		const item = onlyItem(source);

		expect(kinds(item.children)).toEqual(['paragraph', 'paragraph']);
		expect(item.children![1].raw).toBe('  b\n');
	});

	it('is indented code when its columns reach four past the content column', () => {
		const item = onlyItem('- a\n\n\t    code\n');

		expect(kinds(item.children)).toEqual(['paragraph', 'indentedCode']);
		expect(item.children![1].raw).toBe('      code\n');
	});

	it('as a tab-only blank line keeps the next item in the same list', () => {
		const doc = parse('- a\n\t\n- c\n');

		expect(kinds(doc.children)).toEqual(['list']);
		expect(doc.children[0].children).toHaveLength(2);
	});
});

describe('the tab shapes CommonMark already agreed on', () => {
	it('a tab after the marker opens the item', () => {
		expect(onlyItem('-\ta\n').children!.map((c) => c.raw)).toEqual(['a\n']);
	});

	it('a tab after the content column continues the paragraph', () => {
		expect(onlyItem('- a\n  \tb\n').children!.map((c) => c.raw)).toEqual(['a\n  b\n']);
	});
});

describe('a footnote body indented by spaces and a tab', () => {
	it('reads four columns as the body and keeps the tab after them', () => {
		const source = '[^1]: a\n\n  \tb\n\n\t\tc\n';
		const doc = parse(source);

		expect(serialize(doc)).toBe(source);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].children!.map((c) => [c.kind, c.raw])).toEqual([
			['paragraph', 'a\n'],
			['paragraph', 'b\n'],
			['indentedCode', '\tc\n']
		]);
	});
});
