import { describe, it, expect } from 'vitest';
import type { InlineNode } from '#lib/core/nodes.js';
import {
	widgetAtCursor,
	widgetNodeIn,
	widgetsIn,
	findFirstEdgeWidget,
	findLastEdgeWidget,
	rawHasNoTextBefore,
	rawHasNoTextAfter
} from '#lib/components/blocks/text/widget-adjacency.js';
import { parse } from '#lib/core/parser.js';
import { fixtureReading } from '../../harness/fixture-grammar';

function image(start: number, end: number): InlineNode {
	return { kind: 'image', start, end, alt: '', url: 'x.png' };
}

// `![a](x.png)` is 11 chars; the image occupies [0, 11), trailing text after.
const IMAGE_RAW = '![a](x.png) tail\n';

const widgetsOf = (source: string) => widgetsIn(parse(source).children[0], fixtureReading());

describe('widgetsIn', () => {
	it.each([
		['a bare image', IMAGE_RAW, [{ kind: 'image', start: 0, end: 11 }]],
		['an image a link wraps', '[![cat](x.png)](y)\n', [{ kind: 'image', start: 1, end: 14 }]],
		['an image emphasis wraps', '*![cat](x.png)*\n', [{ kind: 'image', start: 1, end: 14 }]],
		['a `<br>`', 'a<br>b\n', [{ kind: 'rawHtml', start: 1, end: 5 }]],
		['no widget for a tag that is not live', 'a<span>b\n', []]
	])('lists %s', (_, source, expected) => {
		expect(widgetsOf(source)).toMatchObject(expected);
		expect(widgetsOf(source)).toHaveLength(expected.length);
	});
});

describe('widgetAtCursor', () => {
	const widgets = [image(0, 11)];

	it('returns leading edge with atRight=false when cursor is at the widget start', () => {
		expect(widgetAtCursor(0, widgets)).toEqual({
			start: 0,
			end: 11,
			atRight: false,
			kind: 'image'
		});
	});

	it('returns trailing edge with atRight=true when cursor is at the widget end', () => {
		expect(widgetAtCursor(11, widgets)).toEqual({
			start: 0,
			end: 11,
			atRight: true,
			kind: 'image'
		});
	});

	it.each([
		['strictly inside the widget', 5],
		['past the widget', 14],
		['null', null]
	])('returns null for an offset %s', (_, offset) => {
		expect(widgetAtCursor(offset, widgets)).toBeNull();
	});
});

// Two adjacent widgets share a boundary, so a forward key must enter B and a backward key A.
// Picking by document order always returns A, and a forward Delete would then wipe B in one key.
describe('widgetAtCursor at a shared widget boundary', () => {
	const adjacent = [image(0, 11), image(11, 22)];
	const first = { start: 0, end: 11, atRight: true, kind: 'image' };

	it('forward keys resolve the boundary to the following widget (B, leading edge)', () => {
		expect(widgetAtCursor(11, adjacent, 'forward')).toEqual({
			start: 11,
			end: 22,
			atRight: false,
			kind: 'image'
		});
	});

	it('backward keys, and no direction, resolve the boundary to the preceding widget', () => {
		expect(widgetAtCursor(11, adjacent, 'backward')).toEqual(first);
		expect(widgetAtCursor(11, adjacent)).toEqual(first);
	});

	it('direction is inert away from a shared boundary (single trailing edge)', () => {
		expect(widgetAtCursor(11, [image(0, 11)], 'forward')).toEqual(first);
	});
});

describe('widgetNodeIn', () => {
	const at = (source: string, start: number) =>
		widgetNodeIn(parse(source).children[0], start, fixtureReading());

	it.each([
		['an image', IMAGE_RAW, 0, { kind: 'image', start: 0, end: 11 }],
		['a `<br>`', 'a<br>b\n', 1, { kind: 'rawHtml', start: 1, end: 5 }],
		['an image a link wraps', '[![cat](x.png)](y)\n', 1, { kind: 'image', start: 1, end: 14 }]
	])('finds %s by its source start', (_, source, start, expected) => {
		expect(at(source, start)).toMatchObject(expected);
	});

	it.each([
		['the end of a widget', IMAGE_RAW, 11],
		['the start of the link around an image', '[![cat](x.png)](y)\n', 0]
	])('finds nothing at %s', (_, source, start) => {
		expect(at(source, start)).toBeNull();
	});
});

// Where the mode hides a construct's markers, the construct draws only its content, so a picture
// a link or emphasis wraps is the block's edge too.
describe('findFirstEdgeWidget / findLastEdgeWidget', () => {
	const edges = (source: string, mode: 'source' | 'live') => {
		const node = parse(source).children[0];
		const reading = fixtureReading({}, mode);
		const span = (w: InlineNode | null) => w && [w.start, w.end];
		return [span(findFirstEdgeWidget(node, reading)), span(findLastEdgeWidget(node, reading))];
	};

	it.each([
		['a picture then text', '![a](x.png) hi\n', 'live', [[0, 11], null]],
		['text then a picture', 'hi ![a](x.png)\n', 'live', [null, [3, 14]]],
		[
			'a picture a link wraps, live',
			'[![a](x.png)](y)\n',
			'live',
			[
				[1, 12],
				[1, 12]
			]
		],
		[
			'a picture emphasis wraps, live',
			'*![a](x.png)*\n',
			'live',
			[
				[1, 12],
				[1, 12]
			]
		],
		['a picture a link wraps, source', '[![a](x.png)](y)\n', 'source', [null, null]],
		['a link holding a picture and text, live', '[![a](x.png) b](y)\n', 'live', [[1, 12], null]]
	] as const)('%s', (_, source, mode, expected) => {
		expect(edges(source, mode)).toEqual(expected);
	});
});

describe('rawHasNoTextBefore / rawHasNoTextAfter', () => {
	it('reports only-whitespace before an offset', () => {
		expect(rawHasNoTextBefore('   ![a](x.png)', 3)).toBe(true);
		expect(rawHasNoTextBefore('hi ![a](x.png)', 3)).toBe(false);
	});

	it('reports only-whitespace after an offset', () => {
		expect(rawHasNoTextAfter('![a](x.png)  \n', 11)).toBe(true);
		expect(rawHasNoTextAfter('![a](x.png) hi\n', 11)).toBe(false);
	});
});
