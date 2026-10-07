/**
 * Widget edge-select and vertical transparency come from the widget registry, not the image kind,
 * so a non-image live widget (the built-in `<br>` rawHtml widget) passes the same entry predicates.
 * A standalone `<br>\n` parses as an HTML block (CommonMark §4.6 type 7), so a transparent
 * `<br>`-only paragraph needs content that cannot open one, hence `<br><br>`.
 */

import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { describe, it, expect } from 'vitest';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { fixtureReading } from '../harness/fixture-grammar';
import { isVerticallyTransparentNode } from '../../core/inline/transparency';
import {
	findFirstEdgeWidget,
	findLastEdgeWidget
} from '../../components/blocks/text/widget-adjacency';

const paragraph = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

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
		expect(findFirstEdgeWidget(para, fixtureReading())).toMatchObject({
			start: 0,
			end: 4,
			kind: 'rawHtml'
		});
		expect(findLastEdgeWidget(para, fixtureReading())).toMatchObject({
			start: 5,
			end: 9,
			kind: 'rawHtml'
		});
	});

	// Blank padding at a paragraph edge is whitespace the parser cannot keep inside a paragraph,
	// so the node is hand-built to pin the skip-blank-text branch for a `<br>`.
	it.each([
		['findFirstEdgeWidget skips leading blank text to a <br>', '  <br>\n', 'first', [2, 6]],
		['findLastEdgeWidget skips trailing blank text to a <br>', '<br>  \n', 'last', [0, 4]]
	] as const)('%s', (_, raw, edge, span) => {
		const find = edge === 'first' ? findFirstEdgeWidget : findLastEdgeWidget;
		expect(find(paragraph(raw), fixtureReading())).toMatchObject({
			start: span[0],
			end: span[1],
			kind: 'rawHtml'
		});
	});

	// Control: a non-live tag is not a widget, so the finders decline; recognition keys on the
	// registry (`isLiveHtmlTag`), not the node kind and not `image`.
	it('decline a non-live <span> tag at either edge', () => {
		expect(findFirstEdgeWidget(paragraph('<span>\n'), fixtureReading())).toBeNull();
		expect(findLastEdgeWidget(paragraph('<span>\n'), fixtureReading())).toBeNull();
	});
});
