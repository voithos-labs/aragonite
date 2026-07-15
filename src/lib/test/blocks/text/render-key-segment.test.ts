import { describe, it, expect } from 'vitest';
import { renderKeySegmentDiff, islandRenderKeyPart } from '$lib/components/blocks/text/text-render';
import type { IndexedDecoration } from '$lib/decorations/buckets';
import type { WidgetDecoration, ReplaceDecoration } from '$lib/decorations/types';

// A renderKey is `${ambient}\0${raw}\0${ref}\0${imgPolicy}${islandPart}`, where
// islandPart is '' or `\0<sig>`. The diff names which of the five segments moved —
// the interaction trace's rebuild cause. These pin the decomposition directly, off
// the recorder path (the dump is never an assertion target).
function key(parts: {
	ambient?: string;
	raw: string;
	ref?: string;
	img?: string;
	islands?: string;
}) {
	return `${parts.ambient ?? ''}\0${parts.raw}\0${parts.ref ?? ''}\0${parts.img ?? ''}${parts.islands ?? ''}`;
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

	it('names islands when the island part appears', () => {
		const before = key({ raw: 'x' });
		const after = key({ raw: 'x', islands: islandRenderKeyPart([island(1)]) });
		expect(renderKeySegmentDiff(before, after)).toBe('islands');
	});

	it('reports multiple changed segments comma-joined', () => {
		expect(renderKeySegmentDiff(key({ raw: 'a', ref: 'r1' }), key({ raw: 'b', ref: 'r2' }))).toBe(
			'raw,ref'
		);
	});
});
