// @vitest-environment jsdom
// A list item draws its own marker in a cell beside its content, from its metadata bytes, whatever
// its first child is; no child block carries a marker prefix of the item's.
// Miss-analysis: every row asked a text child for the marker, so none saw an item that opens
// with a code block, quote, table or nested list draw no marker and hide its bytes.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { markerPrefixOf } from '#lib/browser/painted.js';
import {
	installLayoutStubs,
	mountEditor,
	blockHostAt,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

/** Each item's own marker text, in document order, nested items included. */
function itemMarkers(path: number[]): (string | null)[] {
	const items = blockHostAt(mounted, path).querySelectorAll('.list-item-block');
	return [...items].map(
		(item) => item.querySelector(':scope > .list-item-marker > .md-marker')?.textContent ?? null
	);
}

describe('a list item draws its own marker', () => {
	it('from its metadata bytes, item by item', () => {
		mounted = mountEditor({ source: '1. alpha\n2. beta\n10. gamma\n' });

		expect(itemMarkers([0])).toEqual(['1. ', '2. ', '10. ']);
	});

	it.each([
		['a code block', '- ```\n  code\n  ```\n', ['- ']],
		['a quote', '1. > quoted\n', ['1. ']],
		['a table', '- | a |\n  | - |\n  | 1 |\n', ['- ']],
		['a nested list', '- - inner\n', ['- ', '- ']],
		['a to-do', '- [x] done\n', ['- [x] ']]
	])('when it opens with %s', (_shape, source, markers) => {
		mounted = mountEditor({ source });

		expect(itemMarkers([0])).toEqual(markers);
		expect(mounted.source()).toBe(source);
	});

	it('and hands no marker prefix to any child block', () => {
		mounted = mountEditor({ source: '- alpha\n\n  beta\n' });

		expect(markerPrefixOf(surfaceAt(mounted, [0, 0, 0]))).toBeNull();
		expect(markerPrefixOf(surfaceAt(mounted, [0, 0, 1]))).toBeNull();
	});
});
