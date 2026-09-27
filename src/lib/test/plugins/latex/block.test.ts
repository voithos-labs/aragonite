// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { getInlineRungs } from '$lib/core/inline/scan/plugin-syntax';
import { roundTripCases } from '$lib/test/support/round-trip';
import { registerMathBlock, MATH_BLOCK } from '$lib/plugins/latex/latex-kind';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';

// latexPlugin requires a renderer; block parsing never renders, so a do-nothing stub
// satisfies the required option without pulling in a math library.
const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

// The block opener and the inline `$` trigger live in independent registries and the platform
// reset clears both; a schema-only reset would let the test below pass on the inline half.
beforeEach(resetPluginPlatformForTests);
afterEach(resetPluginPlatformForTests);

// Recognition starts only once the opener registers: with the plugin absent a `$$` fence is
// ordinary GFM text (a paragraph), byte-identical to plain GFM.
describe('block math is dormant until registered', () => {
	it('leaves a $$…$$ fence as a paragraph with nothing registered', () => {
		const src = '$$\nx^2\n$$\n';
		expect(parse(src).children[0].kind).toBe('paragraph');
		expect(serialize(parse(src))).toBe(src);
	});
});

// A closed single line (`$$…$$`) at column 0 is a one-line block, and a bare `$$` opens one a
// later bare `$$` closes; any other `$$` line, or an unterminated fence, stays a paragraph.
describe('block math recognition', () => {
	beforeEach(registerMathBlock);

	const recognition: Array<[string, string, boolean]> = [
		['multi-line fence', '$$\nx^2\n$$\n', true],
		['single-line fence', '$$x^2$$\n', true],
		['single-line with interior padding', '$$ x^2 $$\n', true],
		['blank line inside the fence', '$$\nx\n\ny\n$$\n', true],
		['unterminated fence', '$$\nx^2\n', false],
		['bare $$ at end of input', '$$\n', false],
		['content on the opener line, unclosed', '$$ x\ny\n', false]
	];
	for (const [name, src, recognized] of recognition) {
		it(`${name} → ${recognized ? 'mathBlock' : 'paragraph'}`, () => {
			expect(parse(src).children[0].kind).toBe(recognized ? MATH_BLOCK : 'paragraph');
		});
	}

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
		installPlugins([latexPlugin({ renderer: stubRenderer })]);
		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
	});
});

// The renderer is required at the type level, unlike mermaid's optional one, so the
// `@ts-expect-error` directives below are the assertions: an optional one fails `npm run check`.
describe('latexPlugin requires an injected renderer', () => {
	it('rejects a missing or empty renderer option at compile time', () => {
		// @ts-expect-error - renderer is required; a bare call omits it
		const noArg = () => latexPlugin();
		// @ts-expect-error - renderer is required; empty options omit it
		const noRenderer = () => latexPlugin({});
		expect(noArg).toBeTypeOf('function');
		expect(noRenderer).toBeTypeOf('function');
	});
});

// A schema reset leaves the inline registries live, so a reinstall re-registers only the block
// kind; an inline check keyed on anything but the surviving kind would throw on reinstall.
describe('latexPlugin reinstall after a platform reset', () => {
	it('re-registers the block kind and leaves the inline path intact', () => {
		installPlugins([latexPlugin({ renderer: stubRenderer })]);
		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
		expect(getInlineRungs('$').length).toBeGreaterThan(0);

		resetPluginPlatformForTests();
		installPlugins([latexPlugin({ renderer: stubRenderer })]);

		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
		expect(getInlineRungs('$').length).toBeGreaterThan(0);
	});
});
