// A plugin value's paste rewrites, by block type, at the one function every paste route that lands
// blocks calls: which block a rewrite claims, in what order, at what depth, and what it costs.
// Miss-analysis: paste rewrites were process-wide text transforms, so no row held a rewrite keyed by
// block type, its order, its depth or its cost.
import { describe, expect, it, vi } from 'vitest';
import { rewrittenPaste } from '#lib/tree-operations/paste/paste-rewrites.js';
import { readBlocks } from '#lib/core/parser.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { everyInstalledPlugin, type PluginActivation } from '#lib/schema/plugin-activation.js';
import type { NodeView } from '#lib/core/node-views.js';

const { grammar } = fixtureReading();

/** The clipboard read as blocks, counting each read. */
function reader(text: string) {
	return vi.fn(() => readBlocks(text, { grammar, scope: 'fragment' }));
}

/** An editor whose plugins list `rewrites`, each keyed by a kind and answering from the node. */
function listing(...rewrites: [kind: string, into: (node: NodeView) => string | null][]) {
	const answer = vi.fn(
		(entry: { rewrite: { into(node: NodeView): string | null } }, node: NodeView) =>
			entry.rewrite.into(node)
	);
	const contributions = {
		rewrites: rewrites.map(([kind, into], i) => ({
			plugin: `p${i}`,
			rewrite: { from: { name: kind, label: kind }, into }
		})),
		// The rewrites here read the node itself.
		clipboardBlocks: () => (node: NodeView) => node,
		answer
	};
	return {
		activation: { ...everyInstalledPlugin, contributions } as unknown as PluginActivation,
		answer
	};
}

const outside = (text: string) => ({ text, plain: false });
const QUOTE = 'a\n\n> q\n\nb\n';

describe('a paste rewrite by block type', () => {
	it('writes its answer in place of each block of its type, and keeps the rest', () => {
		const { activation } = listing(['blockquote', () => 'QUOTE']);
		expect(rewrittenPaste(outside(QUOTE), reader(QUOTE), activation, grammar)).toBe(
			'a\n\nQUOTE\n\nb\n'
		);
	});

	it('leaves a block out for an empty answer', () => {
		const { activation } = listing(['blockquote', () => '']);
		expect(rewrittenPaste(outside(QUOTE), reader(QUOTE), activation, grammar)).toBe('a\n\nb\n');
	});

	// Miss-analysis: the empty answer was given at the top level only; inside a container its only
	// child, the splice left the container with nothing and no line ending, joining what followed.
	it.each([
		['a list item', 'x\n\n- # h\n- keep\n\ny\n', 'x\n\n- keep\n\ny\n'],
		['a quote', 'x\n\n> # h\n\ny\n', 'x\n\ny\n'],
		['a list and the item holding it', 'x\n\n- - # h\n- keep\n\ny\n', 'x\n\n- keep\n\ny\n'],
		['a nested list item', 'x\n\n- a\n  - # h\n  - keep\n\ny\n', 'x\n\n- a\n  - keep\n\ny\n'],
		['every container up to the top, which empties the clipboard', '> - # h\n', '']
	])('takes out with its block %s an empty answer leaves with no child', (_, text, landed) => {
		const { activation } = listing(['heading', () => '']);
		expect(rewrittenPaste(outside(text), reader(text), activation, grammar)).toBe(landed);
	});

	// The blank line between the two goes with the first, so the next starts where the first did.
	it.each([
		['a list item', 'x\n\n- # h\n\n  kept\n- keep\n\ny\n', 'x\n\n- kept\n- keep\n\ny\n'],
		['a quote', 'x\n\n> # h\n>\n> kept\n', 'x\n\n> kept\n'],
		['the clipboard', '# h\n\nkept\n', 'kept\n']
	])(
		'starts %s with its next block where an empty answer takes out the first',
		(_, text, landed) => {
			const { activation } = listing(['heading', () => '']);
			expect(rewrittenPaste(outside(text), reader(text), activation, grammar)).toBe(landed);
		}
	);

	it('writes each claimed block in its own place when an earlier one is left out', () => {
		const text = 'a\n\n> one\n\nb\n\n> two\n';
		const { activation } = listing([
			'blockquote',
			(node) => (node.raw.includes('one') ? '' : 'TWO')
		]);
		expect(rewrittenPaste(outside(text), reader(text), activation, grammar)).toBe(
			'a\n\nb\n\nTWO\n'
		);
	});

	it('writes two claimed blocks under one container, each in its own item', () => {
		const text = '- one\n\n  > a\n\n- two\n\n  > b\n';
		const { activation } = listing(['blockquote', () => 'X']);
		expect(rewrittenPaste(outside(text), reader(text), activation, grammar)).toBe(
			'- one\n\n  X\n\n- two\n\n  X\n'
		);
	});

	it('takes the first listed answer, and offers no answer again', () => {
		const { activation, answer } = listing(
			['blockquote', () => null],
			['blockquote', () => '> again'],
			['blockquote', () => 'never']
		);
		expect(rewrittenPaste(outside(QUOTE), reader(QUOTE), activation, grammar)).toBe(
			'a\n\n> again\n\nb\n'
		);
		expect(answer).toHaveBeenCalledTimes(2);
	});

	it('claims the outermost block of its type, whose blocks inside are not offered', () => {
		const text = '> outer\n>\n> > inner\n';
		const { activation, answer } = listing(['blockquote', () => 'X']);
		expect(rewrittenPaste(outside(text), reader(text), activation, grammar)).toBe('X\n');
		expect(answer).toHaveBeenCalledOnce();
	});

	it("writes a block inside a list item with the item's indent on each new line", () => {
		const text = '- item\n\n  > q\n';
		const { activation } = listing(['blockquote', () => 'one\ntwo']);
		expect(rewrittenPaste(outside(text), reader(text), activation, grammar)).toBe(
			'- item\n\n  one\n  two\n'
		);
	});
});

describe('a paste no rewrite runs on', () => {
	it.each([
		['plain text', { text: QUOTE, plain: true }],
		["the editor's own copy", { text: QUOTE, plain: false, own: 'entry' }]
	])('%s is never read or rewritten', (_, clip) => {
		const { activation, answer } = listing(['blockquote', () => 'QUOTE']);
		const read = reader(QUOTE);
		expect(rewrittenPaste(clip, read, activation, grammar)).toBe(QUOTE);
		expect(read).not.toHaveBeenCalled();
		expect(answer).not.toHaveBeenCalled();
	});

	it('reads nothing where no rewrite is listed', () => {
		const { activation } = listing();
		const read = reader(QUOTE);
		expect(rewrittenPaste(outside(QUOTE), read, activation, grammar)).toBe(QUOTE);
		expect(read).not.toHaveBeenCalled();
	});

	it('builds no block where the clipboard holds no type a rewrite names, and hands back its text', () => {
		const { activation, answer } = listing(['table', () => 'never']);
		const read = reader(QUOTE);
		// The same string back is what spares the core a second read of the clipboard.
		expect(rewrittenPaste(outside(QUOTE), read, activation, grammar)).toBe(QUOTE);
		expect(read).toHaveBeenCalledOnce();
		expect(answer).not.toHaveBeenCalled();
	});
});
