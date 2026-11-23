// @vitest-environment node
// Miss-analysis: a fixed fence matched its opener against the whole line only, so `$$x^2$$` read
// as a paragraph and no row held the one-line form 0.11.5's `$$` block reads and writes.
// The rows are 0.11.5's `$$` reading and write rule, which `oneLine` replaces.
import { describe, expect, it } from 'vitest';
import { definePlugin, fencedBlock, grammar, type Fence } from '#lib/plugin.js';
import { makingOf } from '#lib/schema/block-type.js';
import type { WriteContext } from '#lib/schema/block-kind-descriptor.js';

const DOLLARS: Fence = { open: /\$\$/, close: '$$', oneLine: true };

const mathBlock = (fence: Fence = DOLLARS) =>
	fencedBlock({
		name: 'math',
		label: 'Math',
		interrupts: true,
		sample: ['$$\nx\n$$', '$$x$$'],
		insert: { none: 'a fixture of the one-line rows' },
		fence
	});

const reads = grammar([
	definePlugin({
		name: 'fences',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [mathBlock()] })
	})
]);

const read = (source: string) =>
	reads.parse(source).blocks.map((block) => [block.type.name, block.text, block.body]);

describe('a one-line fence reads', () => {
	it.each([
		['the whole block on a line', '$$x^2$$', [['fences/math', '$$x^2$$', 'x^2']]],
		['spaces inside its fences', '$$ x $$', [['fences/math', '$$ x $$', ' x ']]],
		['four fences as an empty block', '$$$$', [['fences/math', '$$$$', '']]],
		['three as text, the fences overlapping', '$$$', [['paragraph', '$$$', '$$$']]],
		['text past its closer as text', '$$a$$b', [['paragraph', '$$a$$b', '$$a$$b']]],
		['a space past its closer as text', '$$x$$ ', [['paragraph', '$$x$$ ', '$$x$$ ']]],
		['a word past its closer as text', '$$x$$ y', [['paragraph', '$$x$$ y', '$$x$$ y']]],
		['an indented line as text', '  $$x$$', [['paragraph', '  $$x$$', '  $$x$$']]],
		[
			'a line cutting a paragraph short',
			'para\n$$x$$',
			[
				['paragraph', 'para\n', 'para'],
				['fences/math', '$$x$$', 'x']
			]
		],
		[
			'an opener holding text, closed lines below, as text',
			'$$ x\ny\n$$',
			[
				['paragraph', '$$ x\ny\n', '$$ x\ny'],
				['paragraph', '$$', '$$']
			]
		]
	])('%s', (_name, source, blocks) => {
		expect(read(source)).toEqual(blocks);
	});

	// Its body leaves out the line break before the closer, as a code block's does.
	it('reads its fence-line form as before', () => {
		expect(read('$$\nx\n$$')).toEqual([['fences/math', '$$\nx\n$$', 'x']]);
	});
});

const rule = makingOf(mathBlock())!.registration.rawWrite!;
const ctxOf = (raw: string, mode: WriteContext['mode']): WriteContext => ({
	node: { kind: 'fences/math', raw, leadingTrivia: '' } as WriteContext['node'],
	mode,
	lineEnding: '\n'
});

describe('a one-line fence written', () => {
	it.each([
		['a line break typed into its text', '$$x\ny$$\n', 'authored', '$$\nx\ny\n$$\n', 10],
		['the same bytes pasted, its first line closed', '$$x\ny$$\n', 'literal', '$$x$$\ny$$\n', 10],
		['Enter typed mid-text', '$$x^\n2$$', 'authored', '$$\nx^\n2\n$$', 10],
		// Miss-analysis: every break fell past the opener, never right after it, where the first
		// line reads as the fence-line form with no line below to close it.
		['Enter typed at the start of its text', '$$\nx^2$$', 'authored', '$$\n\nx^2\n$$', 10],
		['the same bytes pasted', '$$\nx^2$$', 'literal', '$$\n\nx^2\n$$', 10],
		['its closer cut', '$$x\n', 'authored', '$$x$$\n', 4],
		['its closer cut, pasted', '$$x\n', 'literal', '$$x$$\n', 4],
		['an opener holding text over a second line', '$$ a\nb\n', 'authored', '$$\n a\nb\n$$\n', 8],
		['the same bytes pasted', '$$ a\nb\n', 'literal', '$$ a$$\nb\n', 9],
		['a whole block stays', '$$x^2$$\n', 'literal', '$$x^2$$\n', 8]
	] as const)('%s (%s)', (_name, written, mode, legal, offset) => {
		const ctx = ctxOf('$$x$$\n', mode);
		expect(rule.normalize(written, ctx)).toBe(legal);
		expect(rule.mapOffset(written, written.length, ctx)).toBe(offset);
	});

	it('keeps a caret typed into its text on the same character once the lines split', () => {
		// `$$x^|2$$` with a break typed at the caret: the caret lands before the 2.
		expect(rule.mapOffset('$$x^\n2$$', 5, ctxOf('$$x^2$$\n', 'authored'))).toBe(6);
	});
});

describe('a one-line fence declared', () => {
	it('throws on an opener that ends in a `$` anchor, which no one-line block could match', () => {
		expect(() => mathBlock({ open: /^\$\$$/, close: '$$', oneLine: true })).toThrow(
			/fencedBlock: .*oneLine.*\/\^\\\$\\\$\$\/.*\$/
		);
	});

	it('takes an opener ending in an escaped `$`', () => {
		expect(() => mathBlock({ open: /^\\\$/, close: '\\$', oneLine: true })).not.toThrow();
	});
});
