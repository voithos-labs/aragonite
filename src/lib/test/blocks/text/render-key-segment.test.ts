import { describe, it, expect } from 'vitest';
import { renderKeySegmentDiff } from '$lib/components/blocks/text/text-render';
import { islandRenderKeyPart } from '$lib/decorations/island-dom';
import type { IndexedDecoration } from '$lib/decorations/buckets';
import type { WidgetDecoration, ReplaceDecoration } from '$lib/decorations/types';

// A renderKey is `${ambient}\0${raw}\0${ref}\0${imgPolicy}\0${mode}\0${kind}${islandPart}`, mode
// '' in source. These pin the decomposition directly, off the recorder path (never an assertion).
function key(parts: {
	ambient?: string;
	raw: string;
	ref?: string;
	img?: string;
	mode?: string;
	kind?: string;
	islands?: string;
}) {
	return `${parts.ambient ?? ''}\0${parts.raw}\0${parts.ref ?? ''}\0${parts.img ?? ''}\0${parts.mode ?? ''}\0${parts.kind ?? 'paragraph'}${parts.islands ?? ''}`;
}

const island = (offset: number): IndexedDecoration<WidgetDecoration | ReplaceDecoration> => ({
	index: 0,
	dec: {
		type: 'widget',
		path: [0],
		offset,
		widget: { buildDom: () => document.createElement('span') }
	}
});

describe('renderKeySegmentDiff', () => {
	it('reports (none) for identical keys', () => {
		const k = key({ raw: 'hello' });
		expect(renderKeySegmentDiff(k, k)).toBe('(none)');
	});

	it('names the raw segment on a text edit', () => {
		expect(renderKeySegmentDiff(key({ raw: 'hell' }), key({ raw: 'hello' }))).toBe('raw');
	});

	it('names the ambient segment on a marker-prefix change', () => {
		expect(
			renderKeySegmentDiff(key({ ambient: '> ', raw: 'x' }), key({ ambient: '>> ', raw: 'x' }))
		).toBe('ambient');
	});

	it('names imgPolicy independently of raw', () => {
		expect(
			renderKeySegmentDiff(key({ raw: 'x', img: 'auto' }), key({ raw: 'x', img: 'placeholder' }))
		).toBe('imgPolicy');
	});

	it('names kind when the block kind flips under an unchanged raw', () => {
		expect(renderKeySegmentDiff(key({ raw: '# a' }), key({ raw: '# a', kind: 'heading' }))).toBe(
			'kind'
		);
	});

	it('names islands when the island part appears', () => {
		const before = key({ raw: 'x' });
		const after = key({ raw: 'x', islands: islandRenderKeyPart([island(1)]) });
		expect(renderKeySegmentDiff(before, after)).toBe('islands');
	});

	it('names mode on a presentation flip, independent of islands', () => {
		expect(renderKeySegmentDiff(key({ raw: 'x' }), key({ raw: 'x', mode: 'reading' }))).toBe(
			'mode'
		);
		// The trailing island part must not be mis-attributed when mode is set.
		const islands = islandRenderKeyPart([island(1)]);
		expect(
			renderKeySegmentDiff(key({ raw: 'x', islands }), key({ raw: 'x', mode: 'reading', islands }))
		).toBe('mode');
	});

	it('reports multiple changed segments comma-joined', () => {
		expect(renderKeySegmentDiff(key({ raw: 'a', ref: 'r1' }), key({ raw: 'b', ref: 'r2' }))).toBe(
			'raw,ref'
		);
	});
});
