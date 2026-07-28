// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseInline } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import {
	getInlineWidgetComponent,
	getInlineWidgetEditing,
	__resetInlineWidgetsForTests
} from '$lib/core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerFootnoteReference } from '$lib/plugins/footnotes/footnote-reference';
import { FOOTNOTE_REF_KIND } from '$lib/plugins/footnotes/constants';

function resetInlineState(): void {
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}

beforeEach(resetInlineState);
afterEach(resetInlineState);

const isRef = (n: InlineNode) => n.kind === FOOTNOTE_REF_KIND;
const refsIn = (raw: string) => parseInline(raw, 0, raw.length).filter(isRef);
const scan = (raw: string) => parseInline(raw, 0, raw.length);

// Recognition is gated on registration: with nothing registered the `[` scanner
// runs its built-in bracket handling, so a document authored with footnotes opens
// byte-identically in an editor that lacks the plugin.
describe('footnote reference is dormant until registered', () => {
	it('leaves [^1] to the built-in bracket reading with nothing registered', () => {
		const clean = scan('see [^1] here');
		registerFootnoteReference();
		__resetInlineSyntaxForTests();
		__resetInlineWidgetsForTests();
		__clearDeclaredPluginInlineKindsForTests();
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
			__resetInlineSyntaxForTests();
			__resetInlineWidgetsForTests();
			__clearDeclaredPluginInlineKindsForTests();
			const clean = scan(raw);
			registerFootnoteReference();
			expect(scan(raw)).toEqual(clean);
			expect(refsIn(raw)).toHaveLength(0);
		});
	}

	// Label chars exclude `]` but not `[`, so the first `]` closes: the inner `[^x`
	// is label content, and the claim ends at the first bracket. The trailing `]`
	// rescans as its own literal.
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

	// A trailing `(...)` is not part of the reference — the ref is atomic and the
	// following bytes rescan as ordinary inline content (GFM footnote, not a link).
	it('does not consume a trailing (...) after the reference', () => {
		const nodes = scan('[^1](x)');
		expect(nodes[0]).toMatchObject({ kind: FOOTNOTE_REF_KIND, start: 0, end: 4, label: '1' });
		expect(nodes.some((n) => n.kind === 'link')).toBe(false);
	});
});

describe('footnote reference widget registration', () => {
	beforeEach(() => registerFootnoteReference());

	it('registers a component widget with the reveal-source editing policy', () => {
		expect(getInlineWidgetComponent(FOOTNOTE_REF_KIND as InlineNode['kind'])).toBeDefined();
		expect(getInlineWidgetEditing(FOOTNOTE_REF_KIND as InlineNode['kind'])).toEqual({
			revealSource: true
		});
	});
});
