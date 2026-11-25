import { describe, expect, it } from 'vitest';
import { grammar } from '#lib/plugin.js';
import {
	footnotes,
	assignFootnoteNumbers,
	collectFootnoteReferences
} from '#packages/footnotes/src/index.js';

const read = (source: string) => grammar([footnotes]).parse(source);

describe('footnote numbering (derived, first-reference order)', () => {
	it('numbers by first reference, not by definition order', () => {
		// Reference b before a; define a before b. GFM numbers by reference order.
		const numbers = assignFootnoteNumbers(
			read('Text [^b] then [^a].\n\n[^a]: A def.\n\n[^b]: B def.\n')
		);
		expect(numbers.get('b')).toBe(1);
		expect(numbers.get('a')).toBe(2);
	});

	it('reuses the first number for a repeated reference', () => {
		const doc = read('One [^x], two [^y], again [^x].\n');
		expect(collectFootnoteReferences(doc).map((r) => r.label)).toEqual(['x', 'y', 'x']);
		const numbers = assignFootnoteNumbers(doc);
		expect(numbers.size).toBe(2);
		expect(numbers.get('x')).toBe(1);
	});

	it('numbers a reference that has no definition', () => {
		const numbers = assignFootnoteNumbers(read('An orphan [^missing] reference.\n'));
		expect(numbers.get('missing')).toBe(1);
	});

	it('assigns no number to a definition that is never referenced', () => {
		const numbers = assignFootnoteNumbers(read('Body text with no marks.\n\n[^unused]: A def.\n'));
		expect(numbers.size).toBe(0);
	});

	// Miss-analysis: the pass kept only the block path, and no test read where a reference ends.
	it('records each reference’s bytes, so the way back lands beside the citation', () => {
		const refs = collectFootnoteReferences(read('Body has [^a] and [^b] here.\n'));
		expect(refs.map((r) => [r.from, r.to])).toEqual([
			[9, 13],
			[18, 22]
		]);
	});

	it('finds a reference nested inside a container block, at its document bytes', () => {
		const source = '> A quote with [^q] inside.\n\n[^q]: def.\n';
		const refs = collectFootnoteReferences(read(source));
		expect(refs).toEqual([
			{ label: 'q', from: source.indexOf('[^q]'), to: source.indexOf(' inside') }
		]);
	});

	it('finds a reference nested inside inline emphasis', () => {
		const numbers = assignFootnoteNumbers(read('An *emphasized [^e]* mark.\n'));
		expect(numbers.get('e')).toBe(1);
	});

	// The marker lives in the container's raw, never a prose child, so a definition's own label
	// cannot count as a reference of itself.
	it('does not count a definition marker as a reference of itself', () => {
		expect(assignFootnoteNumbers(read('[^self]: A body that mentions nothing.\n')).size).toBe(0);
		expect(assignFootnoteNumbers(read('[^empty]:\n')).size).toBe(0);
	});

	// A `[^x]` in a code span is an `inlineCode` piece, so reading pieces rather than scanning
	// text rules out this false positive by construction.
	it('ignores a reference-shaped run inside an inline code span', () => {
		const numbers = assignFootnoteNumbers(read('Literal `[^x]` but real [^y].\n'));
		expect(numbers.get('x')).toBeUndefined();
		expect(numbers.get('y')).toBe(1);
		expect(numbers.size).toBe(1);
	});

	// Labels reach the numbering a space after each, which no label holds.
	it('keeps a label holding a non-breaking space whole', () => {
		const numbers = assignFootnoteNumbers(read('One [^a\u00a0b] and [^c].\n'));
		expect([...numbers]).toEqual([
			['a\u00a0b', 1],
			['c', 2]
		]);
	});
});
