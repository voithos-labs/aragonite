import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	footnotesPlugin,
	assignFootnoteNumbers,
	collectFootnoteReferences
} from '$lib/plugins/footnotes';
// Plugin-internal (see the barrel's note): the shared walk keys on the editor's
// content version, so only an editor-mounted widget can call it.
import { footnoteNumbersFor } from '$lib/plugins/footnotes/footnote-numbering';

describe('footnote numbering (derived, first-reference order)', () => {
	beforeEach(() => {
		// Install so `[^label]` parses as a footnote-ref inline node; without the
		// plugin the walk finds no references at all.
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
		const doc = parse('One [^x], two [^y], again [^x].\n');
		expect(collectFootnoteReferences(doc).map((r) => r.label)).toEqual(['x', 'y', 'x']);
		const numbers = assignFootnoteNumbers(doc);
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

	// Miss-analysis: the back gesture landed at offset 0 because the walk recorded only the
	// leaf path, and no test read what a caller would need to land beside the citation.
	it('records where each reference ends, so the way back lands beside the citation', () => {
		const refs = collectFootnoteReferences(parse('Body has [^a] and [^b] here.\n'));
		expect(refs.map((r) => r.end)).toEqual([13, 22]);
	});

	it('finds a reference nested inside a container block', () => {
		const refs = collectFootnoteReferences(parse('> A quote with [^q] inside.\n\n[^q]: def.\n'));
		expect(refs).toHaveLength(1);
		expect(refs[0].label).toBe('q');
		expect(refs[0].path.length).toBeGreaterThan(1);
	});

	it('finds a reference nested inside inline emphasis', () => {
		// The walk recurses into inline children, so a reference inside `*…*` is found.
		const numbers = assignFootnoteNumbers(parse('An *emphasized [^e]* mark.\n'));
		expect(numbers.get('e')).toBe(1);
	});

	// The marker lives in the container raw, never a prose child, so a def's own label
	// cannot count as a reference of itself. A childless def is skipped as a non-leaf.
	it('does not count a definition marker as a reference of itself', () => {
		const numbers = assignFootnoteNumbers(parse('[^self]: A body that mentions nothing.\n'));
		expect(numbers.size).toBe(0);
		const emptyDef = assignFootnoteNumbers(parse('[^empty]:\n'));
		expect(emptyDef.size).toBe(0);
	});

	// A `[^x]` in a code span is an `inlineCode` node, so parsing references rather than
	// text-scanning them rules out this false positive by construction.
	it('ignores a reference-shaped run inside an inline code span', () => {
		const numbers = assignFootnoteNumbers(parse('Literal `[^x]` but real [^y].\n'));
		expect(numbers.get('x')).toBeUndefined();
		expect(numbers.get('y')).toBe(1);
		expect(numbers.size).toBe(1);
	});
});

// The memo key must include the content version: the editor's document is mutated IN
// PLACE, so keying on the document alone hits forever and freezes the numbering at
// whatever the first widget saw.
describe('footnote numbering — the shared per-version walk', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('hands every reader of one version the same map', () => {
		const doc = parse('Body has [^a] and [^b].\n');
		expect(footnoteNumbersFor(doc, 7)).toBe(footnoteNumbersFor(doc, 7));
	});

	it('re-walks the SAME document object once its version moves (the in-place edit)', () => {
		const doc = parse('Body has [^a].\n');
		expect(footnoteNumbersFor(doc, 1).get('a')).toBe(1);

		// Exactly what routine typing does: the block's raw is rewritten in place, so
		// the document's identity is unchanged and only the version says so.
		doc.children[0].raw = 'Now [^z] then [^a].\n';
		const renumbered = footnoteNumbersFor(doc, 2);
		expect(renumbered.get('z')).toBe(1);
		expect(renumbered.get('a')).toBe(2);
	});

	it('keys per document, so two editors on one page do not share a version space', () => {
		const first = parse('First has [^a].\n');
		const second = parse('Second has [^b].\n');
		expect(footnoteNumbersFor(first, 3).get('a')).toBe(1);
		expect(footnoteNumbersFor(second, 3).get('a')).toBeUndefined();
		expect(footnoteNumbersFor(second, 3).get('b')).toBe(1);
	});
});
