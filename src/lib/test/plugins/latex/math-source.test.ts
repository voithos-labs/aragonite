// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mathBodySpan, renderMathSource, reshapeMathEdit } from '$lib/plugins/latex/math-source';

// The painted source's slicer, over both block shapes: the `$$` pair and GitHub's ```math fence.
// Miss-analysis: only the `$$` block's e2e reached the slicer, never the fence shape.

describe('reshapeMathEdit completes a bare source from the block’s own delimiters', () => {
	const completes: Array<[label: string, source: string, text: string, caret: number]> = [
		['a one-line $$ emptied', '$$$$', '$$\n\n$$', 3],
		['a $$ opener straight over its closer', '$$\n$$', '$$\n\n$$', 3],
		['a whitespace-only one-liner', '$$ $$', '$$\n\n$$', 3],
		['a ```math over its closer', '```math\n```', '```math\n\n```', 8],
		['a ~~~math over its closer', '~~~math\n~~~', '~~~math\n\n~~~', 8]
	];
	for (const [label, source, text, caret] of completes) {
		it(`completes ${label}`, () => {
			expect(reshapeMathEdit(source, 0, '\n')).toEqual({ text, caret });
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
			expect(reshapeMathEdit(source, 0, '\n')).toBeNull();
		});
	}
});

// Miss-analysis: every math fixture was LF, so no case saw the opener line read with its `\r`,
// and none completed a one-line `$$$$`, which has no ending of its own, in a CRLF file.
describe('math sources on CRLF keep their line endings', () => {
	const completes: Array<[source: string, text: string, caret: number]> = [
		['```math\r\n```', '```math\r\n\r\n```', 9],
		['$$\r\n$$', '$$\r\n\r\n$$', 4],
		['$$$$', '$$\r\n\r\n$$', 4]
	];
	for (const [source, text, caret] of completes) {
		it(`completes ${JSON.stringify(source)} on CRLF`, () => {
			expect(reshapeMathEdit(source, 0, '\r\n')).toEqual({ text, caret });
		});
	}

	// Miss-analysis: every completion row handed the opener's own ending, so none could tell it
	// apart from the one the document gives a line with none.
	it('keeps an opener’s own LF in a CRLF file', () => {
		expect(reshapeMathEdit('$$\n$$', 0, '\r\n')).toEqual({ text: '$$\n\n$$', caret: 3 });
	});

	it('reads a CRLF $$ block as a fence around its body', () => {
		const source = '$$\r\nx^2\r\n$$';
		const { start, end } = mathBodySpan(source);
		expect(source.slice(start, end)).toBe('x^2');
		expect(renderMathSource(source).querySelectorAll('.md-fence-line')).toHaveLength(2);
	});
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
