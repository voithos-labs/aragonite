// @vitest-environment jsdom
// A list item's marker is a prefix handed to `BlockList` as `ambientPrefixForFirst`, passed to
// child 0 only and drawn only by a prose block, so when child 0 is a nested list (`- - a`) the
// outer marker is dropped on purpose. A control case reads both through `markerPrefixOf`.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { markerPrefixOf } from '#lib/cursor/widget-offset.js';
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

describe('list item ambient marker forwarding', () => {
	it('paints the marker on a prose child 0', () => {
		mounted = mountEditor({ source: '- alpha\n' });

		expect(markerPrefixOf(surfaceAt(mounted, [0, 0, 0]))?.textContent).toBe('- ');
	});

	it('paints the item metadata marker, not a hardcoded bullet', () => {
		mounted = mountEditor({ source: '1. alpha\n2. beta\n' });

		expect(markerPrefixOf(surfaceAt(mounted, [0, 0, 0]))?.textContent).toBe('1. ');
		expect(markerPrefixOf(surfaceAt(mounted, [0, 1, 0]))?.textContent).toBe('2. ');
	});

	// A list takes no `ambientPrefix` prop, so the outer `- ` never reaches the DOM, leaving one
	// marker rendered for the two the source carries.
	it('drops the marker when child 0 is a nested list rather than a prose leaf', () => {
		mounted = mountEditor({ source: '- - a\n' });

		const markers = [...blockHostAt(mounted, [0]).querySelectorAll('.md-marker')];

		expect(markers.map((m) => m.textContent)).toEqual(['- ']);
		expect(markerPrefixOf(surfaceAt(mounted, [0, 0, 0, 0, 0]))?.textContent).toBe('- ');
		expect(mounted.source()).toBe('- - a\n');
	});

	// A second child of the same item draws nothing, or the marker would repeat down every
	// line of a multi-block item.
	it('forwards to child 0 only', () => {
		mounted = mountEditor({ source: '- alpha\n\n  beta\n' });

		expect(markerPrefixOf(surfaceAt(mounted, [0, 0, 0]))?.textContent).toBe('- ');
		expect(markerPrefixOf(surfaceAt(mounted, [0, 0, 1]))).toBeNull();
	});
});
