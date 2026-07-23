import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	footnotesPlugin,
	assignFootnoteNumbers,
	collectFootnoteReferences
} from '$lib/plugins/footnotes';

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

	// The definition is now a container whose marker lives in its own raw, not in a
	// child's bytes — so a def's own label is never miscounted as a reference. An
	// empty (childless) def is the one leaf case, and the skip set covers it.
	it('does not count a definition marker as a reference of itself', () => {
		const numbers = assignFootnoteNumbers(parse('[^self]: A body that mentions nothing.\n'));
		expect(numbers.size).toBe(0);
		const emptyDef = assignFootnoteNumbers(parse('[^empty]:\n'));
		expect(emptyDef.size).toBe(0);
	});
});
