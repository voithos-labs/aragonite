import { beforeEach, describe, it, expect } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { getInlineRungs } from '$lib/core/inline/scan/plugin-syntax';
import { roundTripCases } from '$lib/test/support/round-trip';
import { registerMathBlock, MATH_BLOCK } from '$lib/plugins/latex/latex-kind';
import { latexPlugin } from '$lib/plugins/latex';

// Recognition starts only once the opener registers: with the plugin absent a `$$` fence is
// ordinary GFM text (a paragraph), byte-identical to plain GFM.
describe('block math is dormant until registered', () => {
	it('leaves a $$…$$ fence as a paragraph with nothing registered', () => {
		const src = '$$\nx^2\n$$\n';
		expect(parse(src).children[0].kind).toBe('paragraph');
		expect(serialize(parse(src))).toBe(src);
	});
});

// Which lines open a block is `math-shape-parity.test.ts`'s; these pin the node and its neighbours.
describe('a parsed math block', () => {
	beforeEach(registerMathBlock);

	it('parses a fence to a single source-holding leaf (no children)', () => {
		const node = parse('$$\nx^2\n$$\n').children[0];
		expect(node.kind).toBe(MATH_BLOCK);
		expect(node.children).toBeUndefined();
		expect(node.raw).toBe('$$\nx^2\n$$\n');
	});

	it('interrupts an open paragraph, splitting off multi-line display math', () => {
		const doc = parse('text\n$$\nx^2\n$$\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', MATH_BLOCK]);
	});

	it('interrupts an open paragraph with a single-line fence', () => {
		const doc = parse('text\n$$ x $$\nmore\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', MATH_BLOCK, 'paragraph']);
	});
});

// Serialize re-emits `leadingTrivia + raw`, so a `raw` built from the exact fence bytes
// round-trips. The unterminated rows prove the decline path preserves bytes too.
describe('block math round-trip', () => {
	beforeEach(registerMathBlock);

	roundTripCases([
		'$$\nx^2\n$$\n',
		'$$x^2$$\n',
		'$$ x^2 $$\n',
		'$$\nx\n\ny\n$$\n',
		'$$\n\\frac{a}{b}\n$$\n\nafter\n',
		'text\n$$\nx^2\n$$\n',
		'text\n$$\nx^2\n',
		'$$\nx^2\n',
		'$$x^2$$',
		'$$\nx^2\n$$'
	]);
});

describe('latexPlugin wires the block opener', () => {
	it('makes a $$…$$ fence parse as a mathBlock through the installed plugin', () => {
		installPlugins([latexPlugin()]);
		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
	});
});

// A schema reset leaves the inline registries live, so a reinstall re-registers only the block
// kind; an inline check keyed on anything but the surviving kind would throw on reinstall.
describe('latexPlugin reinstall after a platform reset', () => {
	it('re-registers the block kind and leaves the inline path intact', () => {
		installPlugins([latexPlugin()]);
		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
		expect(getInlineRungs('$').length).toBeGreaterThan(0);

		resetPluginPlatformForTests();
		installPlugins([latexPlugin()]);

		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
		expect(getInlineRungs('$').length).toBeGreaterThan(0);
	});
});
