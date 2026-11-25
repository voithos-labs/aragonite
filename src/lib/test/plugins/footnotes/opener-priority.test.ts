import { beforeEach, describe, expect, it } from 'vitest';
import { parse as parseWith } from '#lib';
import { DEFINITION, footnotesGrammar } from '#lib/test/support/footnotes-grammar.js';

let grammar: ReturnType<typeof footnotesGrammar>;
const parse = (source: string) => parseWith(source, { grammar });

describe('footnote definition opener priority', () => {
	beforeEach(() => {
		grammar = footnotesGrammar();
	});

	it('claims [^label]: as its own kind, outranking linkReferenceDefinition', () => {
		const doc = parse('[^1]: A footnote.\n');
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe(DEFINITION);
	});

	it('declines a plain link reference definition, leaving it to the built-in', () => {
		const doc = parse('[label]: https://example.com\n');
		expect(doc.children[0].kind).toBe('linkReferenceDefinition');
	});

	it('recognizes the definition only under the footnote (^) form', () => {
		const footnote = parse('[^note]: text\n');
		const plain = parse('[note]: https://example.com\n');
		expect(footnote.children[0].kind).toBe(DEFINITION);
		expect(plain.children[0].kind).toBe('linkReferenceDefinition');
	});

	it('claims every [^label]: form, including a valid-URL body', () => {
		// The matcher keys on the leading-caret label, so a URL body matches too; the built-in
		// keeps those labels away from link reference definitions, so no priority contest exists.
		const doc = parse('[^1]: https://example.com\n');
		expect(doc.children[0].kind).toBe(DEFINITION);
	});
});
