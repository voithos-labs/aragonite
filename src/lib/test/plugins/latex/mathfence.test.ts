import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { roundTripCases } from '$lib/test/support/round-trip';
import { registerMathFence, MATH_FENCE, mathDisplaySource } from '$lib/plugins/latex/latex-kind';

// GitHub's third math form: a fence whose info string starts with `math`. Registered below
// `fencedCode`, which would otherwise take every fence.

describe('math fence claims and declines', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMathFence();
	});

	it('claims a ```math fence as a childless source-holding leaf', () => {
		const src = '```math\nx^2 + y^2\n```\n';
		const block = parse(src).children[0];
		expect(block.kind).toBe(MATH_FENCE);
		expect(block.children).toBeUndefined();
		expect(block.raw).toBe(src);
		expect(serialize(parse(src))).toBe(src);
	});

	it('claims a ~~~math fence', () => {
		const src = '~~~math\nx^2\n~~~\n';
		expect(parse(src).children[0].kind).toBe(MATH_FENCE);
		expect(serialize(parse(src))).toBe(src);
	});

	it('claims when math is the first word of a longer info string', () => {
		const src = '```math linenums\nx^2\n```\n';
		expect(parse(src).children[0].kind).toBe(MATH_FENCE);
		expect(serialize(parse(src))).toBe(src);
	});

	it('claims an opener indented up to three spaces', () => {
		const src = '   ```math\nx^2\n```\n';
		expect(parse(src).children[0].kind).toBe(MATH_FENCE);
		expect(serialize(parse(src))).toBe(src);
	});

	it('interrupts an open paragraph', () => {
		const src = 'Above\n```math\nx^2\n```\n';
		const doc = parse(src);
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', MATH_FENCE]);
		expect(serialize(doc)).toBe(src);
	});

	const declined: Array<[label: string, src: string, expectedKind: string]> = [
		['a ```mathx info word', '```mathx\nx\n```\n', 'fencedCode'],
		['a capitalized ```Math info word', '```Math\nx\n```\n', 'fencedCode'],
		['a ```js fence', '```js\nconst x = 1;\n```\n', 'fencedCode'],
		['a bare ``` fence', '```\ncode\n```\n', 'fencedCode'],
		['a four-space-indented fence', '    ```math\n', 'indentedCode']
	];
	for (const [label, src, expectedKind] of declined) {
		it(`declines ${label} back to ${expectedKind}`, () => {
			expect(parse(src).children[0].kind).toBe(expectedKind);
			expect(serialize(parse(src))).toBe(src);
		});
	}
});

// An unterminated fence falls through to the built-in fencedCode, as the `$$` block does and
// mermaid does not, becoming a plain `math` code block with identical bytes.
describe('unterminated math fence declines to fencedCode', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMathFence();
	});

	const unterminated = ['```math\nx^2\nno closer', 'text\n```math\nx^2\n', '```math\n'];
	for (const src of unterminated) {
		it(`declines ${JSON.stringify(src)} to fencedCode, bytes preserved`, () => {
			const doc = parse(src);
			expect(doc.children.some((c) => c.kind === MATH_FENCE)).toBe(false);
			expect(doc.children.some((c) => c.kind === 'fencedCode')).toBe(true);
			expect(serialize(doc)).toBe(src);
		});
	}
});

// CRLF threading: the closer line and its ending survive verbatim through raw.
describe('math fence round-trip', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMathFence();
	});

	roundTripCases([
		'```math\nx^2\n```\n',
		'```math\n\\frac{a}{b}\n```\n\nafter\n',
		'```math\nx\n\ny\n```\n',
		'```math\r\nx^2\r\n```\r\n',
		'```math\nx^2\n```'
	]);
});

describe('math fence with the plugin uninstalled', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it('parses as plain fencedCode and serializes byte-identically', () => {
		const src = '```math\nx^2\n```\n';
		const doc = parse(src);
		expect(doc.children[0].kind).toBe('fencedCode');
		expect(serialize(doc)).toBe(src);
	});
});

// The inner LaTeX comes from the stored source, whichever wrapper (`$$` or a fence) it uses.
// Miss-analysis: every case padded with ASCII, never a non-breaking space KaTeX would paint.
describe('mathDisplaySource strips the wrapper to the inner formula', () => {
	const cases: Array<[label: string, source: string, inner: string]> = [
		['bare $$ multi-line', '$$\nx^2\n$$', 'x^2'],
		['single-line $$', '$$x^2$$', 'x^2'],
		['$$ with padding', '$$ x^2 $$', 'x^2'],
		['```math fence', '```math\nx^2\n```\n', 'x^2'],
		['fence with info suffix', '```math linenums\nx^2\n```\n', 'x^2'],
		['fence keeps an interior blank line', '```math\nx\n\ny\n```\n', 'x\n\ny'],
		['~~~math fence', '~~~math\n\\alpha\n~~~\n', '\\alpha'],
		['CRLF fence', '```math\r\nx^2\r\n```\r\n', 'x^2'],
		// KaTeX paints a non-breaking space, so the padding trim leaves it in.
		['$$ with a non-breaking space', '$$\u00a0x^2 $$', '\u00a0x^2']
	];
	for (const [label, source, inner] of cases) {
		it(label, () => {
			expect(mathDisplaySource(source)).toBe(inner);
		});
	}
});
