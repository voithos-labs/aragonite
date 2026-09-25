/**
 * Widget edge-select and vertical transparency come from the widget registry, not from the image
 * kind: a non-image live widget (the built-in `<br>` rawHtml widget) must pass the same entry
 * predicates. Tying recognition to `kind === 'image'` turns the `<br>` assertions red.
 * A standalone `<br>\n` parses as an HTML block (CommonMark §4.6 type 7), so a transparent
 * `<br>`-only paragraph needs content that cannot open one, hence `<br><br>`.
 */

import { defaultGrammarView } from '$lib/schema/block-openers';
import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { getInlineContent } from '../../core/inline/inline-cache';
import { isVerticallyTransparentNode } from '../../core/inline/transparency';
import {
	findFirstEdgeWidget,
	findLastEdgeWidget
} from '../../components/blocks/text/widget-adjacency';

function text(start: number, end: number, value: string): InlineNode {
	return { kind: 'text', start, end, text: value };
}

function rawHtml(start: number, end: number): InlineNode {
	return { kind: 'rawHtml', start, end };
}

describe('vertical transparency for a non-image widget', () => {
	it('is true for a <br>-only paragraph', () => {
		expect(isVerticallyTransparentNode(parse('<br><br>\n').children[0], defaultGrammarView)).toBe(
			true
		);
	});

	it('is true when only blank text sits between <br> widgets', () => {
		expect(isVerticallyTransparentNode(parse('<br> <br>\n').children[0], defaultGrammarView)).toBe(
			true
		);
	});

	it('is false once real text joins the <br>', () => {
		expect(isVerticallyTransparentNode(parse('a<br>\n').children[0], defaultGrammarView)).toBe(
			false
		);
	});
});

describe('edge-widget helpers for a non-image widget', () => {
	it('locate the <br> in the real parsed inline content enterEdgeWidget walks', () => {
		const para = parse('<br> <br>\n').children[0];
		const inlines = getInlineContent(para, undefined, undefined, defaultGrammarView);
		expect(findFirstEdgeWidget(inlines, para.raw, defaultGrammarView)).toMatchObject({
			start: 0,
			end: 4,
			kind: 'rawHtml'
		});
		expect(findLastEdgeWidget(inlines, para.raw, defaultGrammarView)).toMatchObject({
			start: 5,
			end: 9,
			kind: 'rawHtml'
		});
	});

	// Blank padding at a paragraph edge is whitespace the parser cannot keep inside a paragraph,
	// so the node is hand-built to pin the skip-blank-text branch for a `<br>`.
	it('findFirstEdgeWidget skips leading blank text to a <br>', () => {
		const raw = '  <br>\n';
		expect(
			findFirstEdgeWidget([text(0, 2, '  '), rawHtml(2, 6)], raw, defaultGrammarView)
		).toMatchObject({
			start: 2,
			end: 6,
			kind: 'rawHtml'
		});
	});

	it('findLastEdgeWidget skips trailing blank text to a <br>', () => {
		const raw = '<br>  \n';
		expect(
			findLastEdgeWidget([rawHtml(0, 4), text(4, 6, '  ')], raw, defaultGrammarView)
		).toMatchObject({
			start: 0,
			end: 4,
			kind: 'rawHtml'
		});
	});

	// Control: a non-live tag is not a widget, so the finders decline; recognition keys on the
	// registry (`isLiveHtmlTag`), not the node kind and not `image`.
	it('decline a non-live <span> tag at either edge', () => {
		const raw = '<span>\n';
		expect(findFirstEdgeWidget([rawHtml(0, 6)], raw, defaultGrammarView)).toBeNull();
		expect(findLastEdgeWidget([rawHtml(0, 6)], raw, defaultGrammarView)).toBeNull();
	});
});
