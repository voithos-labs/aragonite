// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mathDisplaySource, reshapeMathEdit } from '#lib/plugins/latex/math-source.js';

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
});

// Miss-analysis: every case padded with ASCII, never a non-breaking space KaTeX would paint.
it('keeps a non-breaking space the formula pads with', () => {
	expect(mathDisplaySource('$$\u00a0x^2 $$')).toBe('\u00a0x^2');
});
