import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerMathFence, MATH_FENCE, mathDisplaySource } from '$lib/plugins/latex/latex-kind';

// GitHub's third math form: a fence whose info string opens with `math`. Priced below
// `fencedCode`, whose superset matcher would otherwise claim every fence.

describe('math fence claims and declines', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
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

// Unterminated declines to the built-in fencedCode (matching the sibling `$$`
// block's decline path, not mermaid's consume-to-EOF), so it becomes a plain
// `math` code block — byte-identical either way.
describe('unterminated math fence declines to fencedCode', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
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
		__resetSchemaRegistriesForTests();
		registerMathFence();
	});

	const roundTrip = [
		'```math\nx^2\n```\n',
		'```math\n\\frac{a}{b}\n```\n\nafter\n',
		'```math\nx\n\ny\n```\n',
		'~~~math\nx^2\n~~~\n',
		'```math\r\nx^2\r\n```\r\n',
		'```math\nx^2\n```',
		'   ```math\nx^2\n```\n'
	];
	for (const src of roundTrip) {
		it(`round-trips ${JSON.stringify(src)}`, () => {
			expect(serialize(parse(src))).toBe(src);
		});
	}
});

describe('math fence with the plugin uninstalled', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('parses as plain fencedCode and serializes byte-identically', () => {
		const src = '```math\nx^2\n```\n';
		const doc = parse(src);
		expect(doc.children[0].kind).toBe('fencedCode');
		expect(serialize(doc)).toBe(src);
	});
});

// The render component reads the inner LaTeX from stored source, whichever wrapper
// the source carries — the same helper serves the `$$` block and the fence.
describe('mathDisplaySource strips the wrapper to the inner formula', () => {
	const cases: Array<[label: string, source: string, inner: string]> = [
		['bare $$ multi-line', '$$\nx^2\n$$', 'x^2'],
		['single-line $$', '$$x^2$$', 'x^2'],
		['$$ with padding', '$$ x^2 $$', 'x^2'],
		['```math fence', '```math\nx^2\n```\n', 'x^2'],
		['fence with info suffix', '```math linenums\nx^2\n```\n', 'x^2'],
		['fence keeps an interior blank line', '```math\nx\n\ny\n```\n', 'x\n\ny'],
		['~~~math fence', '~~~math\n\\alpha\n~~~\n', '\\alpha'],
		['CRLF fence', '```math\r\nx^2\r\n```\r\n', 'x^2']
	];
	for (const [label, source, inner] of cases) {
		it(label, () => {
			expect(mathDisplaySource(source)).toBe(inner);
		});
	}
});
