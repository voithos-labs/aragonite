// A range entering or leaving a container copies the lines it covers with that container's
// markers, each written by the container's own rebuild; the container both ends sit in adds none.
// Miss-analysis (#815): the copy rows held a container whole or started in its sole child, so a
// range ending inside a quote, or starting in a list item's second paragraph, was never copied.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { installPlugins, parse } from '#lib';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { copiedText } from '#lib/test/harness/copied-text.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { displayLength } from '#lib/core/lines.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

// Source mode, where a copied range carries its bytes as they stand.
const SOURCE_READING = fixtureReading({}, 'source');

beforeEach(() => {
	installPlugins([admonitionsPlugin(), detailsPlugin(), footnotesPlugin()]);
});

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

function copied(source: string, start: SelectionPoint, end: SelectionPoint): string {
	const doc = parse(source);
	return copiedText(doc, start, end, SOURCE_READING);
}

const POEM =
	'alpha bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you set out for Ithaka\n> > hope your road is a long one,\n';

const ROWS: {
	name: string;
	source: string;
	start: SelectionPoint;
	end: SelectionPoint;
	copy: string;
}[] = [
	{
		name: 'a paragraph into a nested quote',
		source: POEM,
		start: at([0], 6),
		end: at([1, 1, 0], 7),
		copy: 'bravo charlie\n\n> Ithaka\n> By C. P. Cavafy\n> > As you '
	},
	{
		name: 'a quote out to a paragraph',
		source: '> one two\n> three\n\nafter para\n',
		start: at([0, 0], 4),
		end: at([1], 3),
		copy: '> two\n> three\n\naft'
	},
	{
		name: 'a bullet item out to a paragraph',
		source: '- one two\n- three\n\nafter\n',
		start: at([0, 0, 0], 4),
		end: at([1], 3),
		copy: '- two\n- three\n\naft'
	},
	{
		name: 'an ordered item out to a paragraph',
		source: '1. one two\n2. three\n\nafter\n',
		start: at([0, 0, 0], 4),
		end: at([1], 3),
		copy: '1. two\n2. three\n\naft'
	},
	{
		name: 'a paragraph into a list item',
		source: 'alpha beta\n\n- one two\n- three four\n',
		start: at([0], 6),
		end: at([1, 1, 0], 3),
		copy: 'beta\n\n- one two\n- thr'
	},
	{
		name: "an item's second paragraph out to a paragraph",
		source: '- one\n\n  two three\n\nafter\n',
		start: at([0, 0, 1], 4),
		end: at([1], 3),
		copy: '- three\n\naft'
	},
	{
		name: 'a nested list item out to a paragraph',
		source: '- outer\n  - inner one\n\nafter\n',
		start: at([0, 0, 1, 0, 0], 6),
		end: at([1], 3),
		copy: '- - one\n\naft'
	},
	{
		name: 'both ends inside one quote',
		source: '> a b\n>\n> c d\n',
		start: at([0, 0], 2),
		end: at([0, 1], 1),
		copy: 'b\n\nc'
	},
	{
		name: 'inside a quote into the quote nested in it',
		source: '> alpha\n>\n> > beta gamma\n',
		start: at([0, 0], 2),
		end: at([0, 1, 0], 4),
		copy: 'pha\n\n> beta'
	},
	{
		name: 'a footnote definition out to a paragraph',
		source: '[^a]: alpha beta\n\nafter\n',
		start: at([0, 0], 6),
		end: at([1], 3),
		copy: '[^a]: beta\n\naft'
	},
	{
		name: 'a paragraph into a GitHub alert',
		source: 'before\n\n> [!NOTE]\n> alpha beta\n',
		start: at([0], 3),
		end: at([1, 0], 5),
		copy: 'ore\n\n> [!NOTE]\n> alpha'
	},
	{
		name: 'a paragraph into an admonition',
		source: 'before text\n\n:::note Title\n\nbody one\n\n:::\n',
		start: at([0], 7),
		end: at([1, 1], 4),
		copy: 'text\n\n:::note Title\n\nbody\n:::'
	},
	{
		name: 'a paragraph into a details body',
		source: 'before text\n\n<details>\n<summary>Sum</summary>\n\nShown text\n\n</details>\n',
		start: at([0], 7),
		end: at([1, 1], 5),
		copy: 'text\n\n<details>\n<summary>Sum</summary>\n\nShown\n</details>'
	}
];

describe('a range entering or leaving a container copies its markers', () => {
	for (const row of ROWS) {
		it(row.name, () => {
			expect(copied(row.source, row.start, row.end)).toBe(row.copy);
		});
	}
});

// ── The property ────────────────────────────────────────────────────────────

// Quotes and lists, nested and side by side, around plain paragraphs.
const NESTED =
	'lead para one\n\n> quote line one\n> quote line two\n>\n> > nested quote one\n\nmid para two\n\n- item alpha one\n- item beta two\n  - nested gamma three\n\n1. first item four\n2. second item five\n\ntail para six\n';

interface Leaf {
	path: number[];
	/** The kinds of the containers above the leaf, outermost first. */
	chain: string[];
	length: number;
}

function leavesOf(nodes: readonly CstNode[], path: number[] = [], chain: string[] = []): Leaf[] {
	return nodes.flatMap((node, i) => {
		const here = [...path, i];
		if (!node.children?.length) {
			const length = displayLength(node.raw);
			return length > 2 ? [{ path: here, chain, length }] : [];
		}
		return leavesOf(node.children, here, [...chain, node.kind]);
	});
}

function firstLeafChain(doc: Document | CstNode): string[] {
	const chain: string[] = [];
	let node: Document | CstNode = doc;
	while (node.children?.length) {
		if (node.kind !== 'document') chain.push(node.kind);
		node = node.children[0];
	}
	return chain;
}

function lastLeafChain(doc: Document | CstNode): string[] {
	const chain: string[] = [];
	let node: Document | CstNode = doc;
	while (node.children?.length) {
		if (node.kind !== 'document') chain.push(node.kind);
		node = node.children[node.children.length - 1];
	}
	return chain;
}

const sharedDepth = (a: number[], b: number[]): number => {
	let depth = 0;
	while (depth < a.length - 1 && depth < b.length - 1 && a[depth] === b[depth]) depth++;
	return depth;
};

describe('the copy keeps every container an end sits in, below the one both share', () => {
	it('holds for ranges between any two leaves of a nested document', () => {
		const leaves = leavesOf(parse(NESTED).children);
		const pairs = fc
			.tuple(fc.nat({ max: leaves.length - 1 }), fc.nat({ max: leaves.length - 1 }))
			.filter(([a, b]) => a < b)
			.chain(([a, b]) =>
				fc.tuple(
					fc.constant(leaves[a]),
					fc.integer({ min: 1, max: leaves[a].length - 1 }),
					fc.constant(leaves[b]),
					fc.integer({ min: 1, max: leaves[b].length - 1 })
				)
			);
		fc.assert(
			fc.property(pairs, ([from, fromOffset, to, toOffset]) => {
				const copy = copied(NESTED, at(from.path, fromOffset), at(to.path, toOffset));
				const depth = sharedDepth(from.path, to.path);
				// Items the copy holds read back inside a list, whichever list they shared.
				const around = from.chain[depth - 1] === 'list' ? ['list'] : [];
				const pasted = parse(copy);
				expect(firstLeafChain(pasted)).toEqual([...around, ...from.chain.slice(depth)]);
				expect(lastLeafChain(pasted)).toEqual([...around, ...to.chain.slice(depth)]);
			})
		);
	});
});
