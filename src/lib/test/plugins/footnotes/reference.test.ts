import { beforeEach, describe, expect, it } from 'vitest';
import { parseInline, type InlineNode } from '#lib';
import { getInlineWidgetEditing } from '#lib/core/inline/inline-widgets.js';
import { REFERENCE, footnotesGrammar } from '#lib/test/support/footnotes-grammar.js';

let grammar: ReturnType<typeof footnotesGrammar> | undefined;
const isRef = (n: InlineNode) => n.kind === REFERENCE;
const scan = (raw: string) => parseInline(raw, 0, raw.length, undefined, grammar);
const refsIn = (raw: string) => scan(raw).filter(isRef);

beforeEach(() => {
	grammar = footnotesGrammar();
});

// An editor that leaves footnotes out runs the built-in bracket reading, so a document authored
// with footnotes opens byte-identically there.
describe('footnote reference in an editor that leaves footnotes out', () => {
	it('leaves [^1] to the built-in bracket reading', () => {
		const listed = scan('see [^1] here');
		grammar = undefined;
		const clean = scan('see [^1] here');
		expect(clean.some(isRef)).toBe(false);
		expect(listed.some(isRef)).toBe(true);
	});
});

describe('[^label] recognizer grammar', () => {
	it('claims [^1] through the closing bracket, carrying the label', () => {
		const [node] = refsIn('a [^1] b');
		expect(node).toMatchObject({ kind: REFERENCE, start: 2, end: 6, data: '1' });
	});

	it('claims a long hyphenated label', () => {
		const [node] = refsIn('see [^long-label].');
		expect(node).toMatchObject({ start: 4, end: 17, data: 'long-label' });
	});

	const declines: Array<[string, string]> = [
		['no caret', '[x]'],
		['empty label', '[^]'],
		['whitespace in label', '[^a b]'],
		['unterminated before end', '[^unclosed']
	];
	for (const [name, raw] of declines) {
		it(`declines ${name} (${raw}) and falls back byte-identically`, () => {
			const listed = scan(raw);
			grammar = undefined;
			expect(listed).toEqual(scan(raw));
			expect(listed.some(isRef)).toBe(false);
		});
	}

	// Label chars exclude `]` but not `[`, so the inner `[^x` is label content, the first `]`
	// closes, and the trailing `]` rescans as its own literal.
	it('reads [^nested[^x]] as label "nested[^x", closing at the first bracket', () => {
		const nodes = scan('[^nested[^x]]');
		expect(nodes[0]).toMatchObject({ kind: REFERENCE, start: 0, end: 12, data: 'nested[^x' });
		expect(nodes[nodes.length - 1]).toMatchObject({ kind: 'text', text: ']' });
	});

	// GitHub reads a reference followed by a destination as a link, footnote defined or not.
	it('leaves [^1](x) to the link it closes as', () => {
		const nodes = scan('[^1](x)');
		expect(nodes).toMatchObject([{ kind: 'link', start: 0, end: 7, url: 'x' }]);
		expect(nodes.some(isRef)).toBe(false);
	});
});

describe('footnote reference widget', () => {
	it('shows its source on a plain click and claims the activation click', () => {
		// `revealSource` is what a plain click does, and `claimsActivationClick` turns that off so
		// the click jumps instead; a Backspace selects it first, as the editor's default did.
		expect(getInlineWidgetEditing(REFERENCE as InlineNode['kind'], grammar!)).toEqual({
			revealSource: true,
			claimsActivationClick: true,
			deleteGranularity: 'select-then-delete'
		});
	});
});
