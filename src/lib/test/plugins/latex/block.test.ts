// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '$lib';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { getInlineRungs, __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __resetInlineWidgetsForTests } from '$lib/core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerMathBlock, MATH_BLOCK } from '$lib/plugins/latex/latex-kind';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';

// latexPlugin requires an injected renderer; block parsing never renders, so a
// no-op stub satisfies the required option without pulling a math engine in.
const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

// The block opener and the inline `$` trigger register through independent
// registries, so both are reset — else a `latexPlugin()` install would leave
// inline live and the gating test would pass for the wrong reason.
function resetLatexState(): void {
	__resetSchemaRegistriesForTests();
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}

beforeEach(resetLatexState);
afterEach(resetLatexState);

// Recognition is gated on the opener registering — with no extension loaded a
// `$$` fence is ordinary GFM text (a paragraph), byte-identical to bare GFM.
describe('block math is dormant until registered', () => {
	it('leaves a $$…$$ fence as a paragraph with nothing registered', () => {
		const src = '$$\nx^2\n$$\n';
		expect(parse(src).children[0].kind).toBe('paragraph');
		expect(serialize(parse(src))).toBe(src);
	});
});

// Grammar: the opener sits at column 0. A closed single line (`$$…$$`, length
// ≥ 4) is a one-line block; a bare `$$` opens a multi-line block that a later
// bare `$$` closes. Anything else starting with `$$` (e.g. `$$ x` unclosed)
// declines to a paragraph, as does an unterminated bare fence.
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

	const roundTrip = [
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
	];
	for (const src of roundTrip) {
		it(`round-trips ${JSON.stringify(src)}`, () => {
			expect(serialize(parse(src))).toBe(src);
		});
	}
});

describe('latexPlugin wires the block opener', () => {
	it('makes a $$…$$ fence parse as a mathBlock through the installed plugin', () => {
		installPlugins([latexPlugin({ renderer: stubRenderer })]);
		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
	});
});

// The renderer is REQUIRED (no baked-in engine, unlike mermaid's optional one), and the
// contract lives at the type level — so the `@ts-expect-error` directives below are the
// assertions: a regression to an optional renderer fails `npm run check`.
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

// A schema reset clears the block registry but leaves the inline registries live, so a
// reinstall must re-register the block kind yet NOT the inline one. The inline guard is
// keyed on the surviving declared kind; mis-key it and the re-register throws.
describe('latexPlugin reinstall after a schema reset', () => {
	it('re-registers the block kind and leaves the inline path intact', () => {
		installPlugins([latexPlugin({ renderer: stubRenderer })]);
		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
		expect(getInlineRungs('$').length).toBeGreaterThan(0);

		__resetSchemaRegistriesForTests();
		installPlugins([latexPlugin({ renderer: stubRenderer })]);

		expect(parse('$$\nx^2\n$$\n').children[0].kind).toBe(MATH_BLOCK);
		expect(getInlineRungs('$').length).toBeGreaterThan(0);
	});
});
