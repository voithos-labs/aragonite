// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
	completeBareMathSource,
	mathBodySpan,
	renderMathSource
} from '$lib/plugins/latex/math-source';

// The painted source's slicer, over both block shapes: the `$$` pair and GitHub's ```math fence.
// Miss-analysis: math-source.ts carried no unit test, so the slicer was exercised only through
// the `$$` block's e2e, and the fence shape it never recognized looked right as long as no
// scenario asked what it painted or what a completion rebuilt.

describe('completeBareMathSource rebuilds from the block’s own delimiters', () => {
	const completes: Array<[label: string, source: string, text: string, caret: number]> = [
		['a one-line $$ emptied', '$$$$', '$$\n\n$$', 3],
		['a $$ opener straight over its closer', '$$\n$$', '$$\n\n$$', 3],
		['a whitespace-only one-liner', '$$ $$', '$$\n\n$$', 3],
		['a ```math over its closer', '```math\n```', '```math\n\n```', 8],
		['a ~~~math over its closer', '~~~math\n~~~', '~~~math\n\n~~~', 8]
	];
	for (const [label, source, text, caret] of completes) {
		it(`completes ${label}`, () => {
			expect(completeBareMathSource(source)).toEqual({ text, caret });
		});
	}

	// A closer repeats its opener's own marker at its length or longer, so neither of the last
	// two closes anything and neither block is bare.
	const leftAlone = [
		'$$\n\n$$',
		'```math\n\n```',
		'$$x^2$$',
		'```math\nx^2\n```',
		'~~~math\n```',
		'````math\n```',
		'loose prose'
	];
	for (const source of leftAlone) {
		it(`leaves ${JSON.stringify(source)} alone`, () => {
			expect(completeBareMathSource(source)).toBeNull();
		});
	}
});

describe('mathBodySpan names the body of either shape', () => {
	const cases: Array<[source: string, body: string]> = [
		['$$x^2$$', 'x^2'],
		['$$\nx^2\n$$', 'x^2'],
		['$$ x^2 $$', ' x^2 '],
		['```math\nx^2\n```', 'x^2'],
		['```math linenums\nx^2\n```', 'x^2'],
		['~~~math\n\\alpha\n~~~', '\\alpha']
	];
	for (const [source, body] of cases) {
		it(`spans the body of ${JSON.stringify(source)}`, () => {
			const { start, end } = mathBodySpan(source);
			expect(source.slice(start, end)).toBe(body);
		});
	}
});

describe('renderMathSource paints both fence lines as marker chrome', () => {
	const sources = ['$$\nx^2\n$$', '$$x^2$$', '```math\nx^2\n```', '~~~math\nx^2\n~~~'];
	for (const source of sources) {
		it(`wraps the delimiters of ${JSON.stringify(source)} and keeps every byte`, () => {
			const frag = renderMathSource(source);
			expect(frag.textContent).toBe(source);
			expect(frag.querySelectorAll('.md-fence-line')).toHaveLength(2);
		});
	}

	it('paints a source shaped like neither form as plain tokens', () => {
		const frag = renderMathSource('loose prose');
		expect(frag.textContent).toBe('loose prose');
		expect(frag.querySelectorAll('.md-fence-line')).toHaveLength(0);
	});
});
