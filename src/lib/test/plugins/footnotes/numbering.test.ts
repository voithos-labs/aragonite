import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin } from '../../../../routes/test/plugins/footnotes/footnotes-plugin';
import {
	assignFootnoteNumbers,
	collectFootnoteReferences,
	footnoteReferenceDecorations
} from '../../../../routes/test/plugins/footnotes/footnote-numbering';

describe('footnote numbering (derived, first-reference order)', () => {
	beforeEach(() => {
		// Install so definition blocks parse as footnote-def and the scan skips them —
		// otherwise a definition's leading [^label] is mis-counted as a reference.
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('numbers by first reference, not by definition order', () => {
		// Reference b before a; define a before b. GFM numbers by reference order.
		const numbers = assignFootnoteNumbers(
			parse('Text [^b] then [^a].\n\n[^a]: A def.\n\n[^b]: B def.\n')
		);
		expect(numbers.get('b')).toBe(1);
		expect(numbers.get('a')).toBe(2);
	});

	it('reuses the first number for a repeated reference', () => {
		const refs = collectFootnoteReferences(parse('One [^x], two [^y], again [^x].\n'));
		expect(refs.map((r) => r.label)).toEqual(['x', 'y', 'x']);
		const numbers = assignFootnoteNumbers(parse('One [^x], two [^y], again [^x].\n'));
		expect(numbers.size).toBe(2);
		expect(numbers.get('x')).toBe(1);
	});

	it('numbers a reference that has no definition', () => {
		const numbers = assignFootnoteNumbers(parse('An orphan [^missing] reference.\n'));
		expect(numbers.get('missing')).toBe(1);
	});

	it('assigns no number to a definition that is never referenced', () => {
		const numbers = assignFootnoteNumbers(parse('Body text with no marks.\n\n[^unused]: A def.\n'));
		expect(numbers.get('unused')).toBeUndefined();
		expect(numbers.size).toBe(0);
	});

	it('finds references nested inside a container block', () => {
		const refs = collectFootnoteReferences(parse('> A quote with [^q] inside.\n\n[^q]: def.\n'));
		expect(refs).toHaveLength(1);
		expect(refs[0].label).toBe('q');
		expect(refs[0].path.length).toBeGreaterThan(1);
	});
});

describe('footnote reference decorations', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('emits one numbered replace island per reference over the exact bytes', () => {
		const src = 'A [^b] and [^a] and [^b] tail.\n';
		const doc = parse(src);
		const paraRaw = doc.children[0].raw;
		const decos = footnoteReferenceDecorations(doc);

		expect(decos.map((d) => d.type)).toEqual(['replace', 'replace', 'replace']);
		expect(decos.map((d) => paraRaw.slice(d.start, d.end))).toEqual(['[^b]', '[^a]', '[^b]']);
		// Number rides the class (widget identity is class-keyed): b=1, a=2, b=1.
		expect(decos.map((d) => d.class)).toEqual([
			'footnote-ref footnote-ref-1',
			'footnote-ref footnote-ref-2',
			'footnote-ref footnote-ref-1'
		]);
	});
});
