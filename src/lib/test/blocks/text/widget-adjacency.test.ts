import { describe, it, expect } from 'vitest';
import type { InlineNode } from '$lib/core/nodes';
import {
	widgetAtCursor,
	findWidgetNodeByStart,
	findFirstEdgeWidget,
	findLastEdgeWidget,
	rawHasNoTextBefore,
	rawHasNoTextAfter
} from '$lib/components/blocks/text/widget-adjacency';

function text(start: number, end: number, value: string): InlineNode {
	return { kind: 'text', start, end, text: value };
}

function image(start: number, end: number): InlineNode {
	return { kind: 'image', start, end, alt: '', url: 'x.png' };
}

function rawHtml(start: number, end: number): InlineNode {
	return { kind: 'rawHtml', start, end };
}

// `![a](x.png)` is 11 chars; the image occupies [0, 11), trailing text after.
const IMAGE_RAW = '![a](x.png) tail\n';
const imageInlines: InlineNode[] = [image(0, 11), text(11, 16, ' tail')];

describe('widgetAtCursor', () => {
	it('returns leading edge with atRight=false when cursor is at the widget start', () => {
		expect(widgetAtCursor(0, imageInlines, IMAGE_RAW)).toEqual({
			start: 0,
			end: 11,
			atRight: false,
			kind: 'image'
		});
	});

	it('returns trailing edge with atRight=true when cursor is at the widget end', () => {
		expect(widgetAtCursor(11, imageInlines, IMAGE_RAW)).toEqual({
			start: 0,
			end: 11,
			atRight: true,
			kind: 'image'
		});
	});

	it('returns null when cursor is strictly inside the widget range', () => {
		expect(widgetAtCursor(5, imageInlines, IMAGE_RAW)).toBeNull();
	});

	it('returns null when cursor is past the widget in plain text', () => {
		expect(widgetAtCursor(14, imageInlines, IMAGE_RAW)).toBeNull();
	});

	it('returns null for a null offset', () => {
		expect(widgetAtCursor(null, imageInlines, IMAGE_RAW)).toBeNull();
	});

	it('treats a <br> rawHtml node as a live widget but a non-live tag as plain', () => {
		const brRaw = 'a<br>b';
		const brInlines = [text(0, 1, 'a'), rawHtml(1, 5), text(5, 6, 'b')];
		expect(widgetAtCursor(1, brInlines, brRaw)).toEqual({
			start: 1,
			end: 5,
			atRight: false,
			kind: 'rawHtml'
		});

		const spanRaw = 'a<span>b';
		const spanInlines = [text(0, 1, 'a'), rawHtml(1, 7), text(7, 8, 'b')];
		expect(widgetAtCursor(1, spanInlines, spanRaw)).toBeNull();
	});
});

// Two adjacent widgets share a boundary, so a forward key must enter B and a backward key A. The
// old document-order pick always returned A, and a forward Delete wiped B's island in one press.
describe('widgetAtCursor at a shared widget boundary', () => {
	const TWO_IMAGES = '![a](x.png)![b](y.png)\n';
	const adjacentInlines: InlineNode[] = [image(0, 11), image(11, 22)];

	it('forward keys resolve the boundary to the following widget (B, leading edge)', () => {
		expect(widgetAtCursor(11, adjacentInlines, TWO_IMAGES, 'forward')).toEqual({
			start: 11,
			end: 22,
			atRight: false,
			kind: 'image'
		});
	});

	it('backward keys resolve the boundary to the preceding widget (A, trailing edge)', () => {
		expect(widgetAtCursor(11, adjacentInlines, TWO_IMAGES, 'backward')).toEqual({
			start: 0,
			end: 11,
			atRight: true,
			kind: 'image'
		});
	});

	it('defaults to the preceding widget (backward) when no direction is given', () => {
		expect(widgetAtCursor(11, adjacentInlines, TWO_IMAGES)).toEqual({
			start: 0,
			end: 11,
			atRight: true,
			kind: 'image'
		});
	});

	it('direction is inert away from a shared boundary (single trailing edge)', () => {
		expect(widgetAtCursor(11, imageInlines, IMAGE_RAW, 'forward')).toEqual({
			start: 0,
			end: 11,
			atRight: true,
			kind: 'image'
		});
	});
});

describe('findWidgetNodeByStart', () => {
	it('finds a live widget by its source start offset', () => {
		expect(findWidgetNodeByStart(0, imageInlines, IMAGE_RAW)).toEqual({ start: 0, end: 11 });
	});

	it('returns null when no widget starts at the given offset', () => {
		expect(findWidgetNodeByStart(11, imageInlines, IMAGE_RAW)).toBeNull();
	});
});

// `[![cat][shot]][repo]` parses to a link whose child is the image, so the finders must reach
// into the link's children — pre-fix a click-selected image-in-link never resolved.
describe('widget nested inside a link node', () => {
	const NESTED_RAW = '[![cat][shot]][repo]';
	const nestedImage: InlineNode = {
		kind: 'image',
		start: 1,
		end: 13,
		alt: 'cat',
		url: 'resolved.png',
		label: 'shot'
	};
	const nestedInlines: InlineNode[] = [
		{ kind: 'link', start: 0, end: 20, url: 'repo-url', label: 'repo', children: [nestedImage] }
	];

	it('findWidgetNodeByStart finds the nested image by its raw start', () => {
		expect(findWidgetNodeByStart(1, nestedInlines, NESTED_RAW)).toEqual({ start: 1, end: 13 });
	});

	it('findWidgetNodeByStart returns null for the link node start (not a widget)', () => {
		expect(findWidgetNodeByStart(0, nestedInlines, NESTED_RAW)).toBeNull();
	});

	it('widgetAtCursor finds the nested image at its leading edge', () => {
		expect(widgetAtCursor(1, nestedInlines, NESTED_RAW)).toEqual({
			start: 1,
			end: 13,
			atRight: false,
			kind: 'image'
		});
	});

	it('widgetAtCursor finds the nested image at its trailing edge', () => {
		expect(widgetAtCursor(13, nestedInlines, NESTED_RAW)).toEqual({
			start: 1,
			end: 13,
			atRight: true,
			kind: 'image'
		});
	});
});

describe('findFirstEdgeWidget / findLastEdgeWidget', () => {
	it('finds a leading widget after skipping blank text', () => {
		const raw = '  ![a](x.png)\n';
		const inlines = [text(0, 2, '  '), image(2, 13)];
		expect(findFirstEdgeWidget(inlines, raw)).toMatchObject({ start: 2, end: 13, kind: 'image' });
	});

	it('finds a trailing widget after skipping blank text', () => {
		const raw = '![a](x.png)  \n';
		const inlines = [image(0, 11), text(11, 13, '  ')];
		expect(findLastEdgeWidget(inlines, raw)).toMatchObject({ start: 0, end: 11, kind: 'image' });
	});

	it('returns null when non-blank text precedes the first widget', () => {
		const raw = 'hi ![a](x.png)\n';
		const inlines = [text(0, 3, 'hi '), image(3, 14)];
		expect(findFirstEdgeWidget(inlines, raw)).toBeNull();
	});

	it('returns null when non-blank text follows the last widget', () => {
		const raw = '![a](x.png) hi\n';
		const inlines = [image(0, 11), text(11, 14, ' hi')];
		expect(findLastEdgeWidget(inlines, raw)).toBeNull();
	});

	it('returns null for empty inline content', () => {
		expect(findFirstEdgeWidget([], '')).toBeNull();
		expect(findLastEdgeWidget([], '')).toBeNull();
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
