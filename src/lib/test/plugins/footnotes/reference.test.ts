import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseInline, type InlineNode } from '#lib';
import { resetPluginPlatformForTests } from '#lib/testing.js';
import { getInlineWidgetEditing } from '#lib/core/inline/inline-widgets.js';
import { registerFootnoteReference } from '#packages/footnotes/src/footnote-reference.js';
import { FOOTNOTE_REF_KIND } from '#packages/footnotes/src/constants.js';

const isRef = (n: InlineNode) => n.kind === FOOTNOTE_REF_KIND;
const refsIn = (raw: string) => parseInline(raw, 0, raw.length).filter(isRef);
const scan = (raw: string) => parseInline(raw, 0, raw.length);

// With nothing registered the `[` scanner runs its built-in bracket handling, so a document
// authored with footnotes opens byte-identically in an editor that lacks the plugin.
describe('footnote reference is dormant until registered', () => {
	it('leaves [^1] to the built-in bracket reading with nothing registered', () => {
		const clean = scan('see [^1] here');
		registerFootnoteReference();
		resetPluginPlatformForTests();
		expect(scan('see [^1] here')).toEqual(clean);
		expect(clean.some(isRef)).toBe(false);
	});
});

describe('[^label] recognizer grammar', () => {
	beforeEach(() => registerFootnoteReference());

	it('claims [^1] through the closing bracket, carrying the label', () => {
		const [node] = refsIn('a [^1] b');
		expect(node).toMatchObject({ kind: FOOTNOTE_REF_KIND, start: 2, end: 6, label: '1' });
	});

	it('claims a long hyphenated label', () => {
		const [node] = refsIn('see [^long-label].');
		expect(node).toMatchObject({ start: 4, end: 17, label: 'long-label' });
	});

	const declines: Array<[string, string]> = [
		['no caret', '[x]'],
		['empty label', '[^]'],
		['whitespace in label', '[^a b]'],
		['unterminated before end', '[^unclosed']
	];
	for (const [name, raw] of declines) {
		it(`declines ${name} (${raw}) and falls back byte-identically`, () => {
			resetPluginPlatformForTests();
			const clean = scan(raw);
			registerFootnoteReference();
			expect(scan(raw)).toEqual(clean);
			expect(refsIn(raw)).toHaveLength(0);
		});
	}

	// Label chars exclude `]` but not `[`, so the inner `[^x` is label content, the first `]`
	// closes, and the trailing `]` rescans as its own literal.
	it('reads [^nested[^x]] as label "nested[^x", closing at the first bracket', () => {
		const nodes = scan('[^nested[^x]]');
		expect(nodes[0]).toMatchObject({
			kind: FOOTNOTE_REF_KIND,
			start: 0,
			end: 12,
			label: 'nested[^x'
		});
		expect(nodes[nodes.length - 1]).toMatchObject({ kind: 'text', text: ']' });
	});

	// GitHub reads a reference followed by a destination as a link, footnote defined or not.
	it('leaves [^1](x) to the link it closes as', () => {
		const nodes = scan('[^1](x)');
		expect(nodes).toMatchObject([{ kind: 'link', start: 0, end: 7, url: 'x' }]);
		expect(nodes.some(isRef)).toBe(false);
	});
});

describe('footnote reference widget registration', () => {
	beforeEach(() => registerFootnoteReference());

	it('registers a widget that reveals its source and claims the activation click', () => {
		// Both fields: `revealSource` is what a plain click does, and `claimsActivationClick`
		// turns that off so the click jumps instead. Drop it and the source opens on a click.
		expect(
			getInlineWidgetEditing(FOOTNOTE_REF_KIND as InlineNode['kind'], defaultGrammarView)
		).toEqual({
			revealSource: true,
			claimsActivationClick: true
		});
	});
});
