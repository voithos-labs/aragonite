// @vitest-environment jsdom
//
// A list item's marker is not in its own bytes — it is an ambient prefix the item
// hands to `BlockList` as `ambientPrefixForFirst`, which forwards it to child 0 only,
// and only a prose leaf paints it. So when child 0 is a nested LIST (`- - a`), the
// outer item's marker has nowhere to land and is silently dropped from the render.
// That drop is deliberate and documented, and it is exactly the kind of behavior a
// well-meaning "fix" restores; it is also the kind of behavior a test can pretend to
// check while asserting nothing.
//
// So the drop is measured against a positive control in the same file, through the
// same production probe (`ambientSpanOf`), and paired with the source bytes: the CST
// keeps both markers, the DOM shows one.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { ambientSpanOf } from '$lib/ambient/ambient-dom';
import { installLayoutStubs, mountEditor, blockHostAt, surfaceAt } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

describe('list item ambient marker forwarding', () => {
	it('paints the marker on a prose child 0', () => {
		mounted = mountEditor({ source: '- alpha\n' });

		expect(ambientSpanOf(surfaceAt(mounted, [0, 0, 0]))?.textContent).toBe('- ');
	});

	it('paints the item metadata marker, not a hardcoded bullet', () => {
		mounted = mountEditor({ source: '1. alpha\n2. beta\n' });

		expect(ambientSpanOf(surfaceAt(mounted, [0, 0, 0]))?.textContent).toBe('1. ');
		expect(ambientSpanOf(surfaceAt(mounted, [0, 1, 0]))?.textContent).toBe('2. ');
	});

	// The documented drop. The outer item's child 0 is a list, which takes no
	// `ambientPrefix` prop, so the outer `- ` never reaches the DOM — one rendered
	// marker for the two the source carries.
	it('drops the marker when child 0 is a nested list rather than a prose leaf', () => {
		mounted = mountEditor({ source: '- - a\n' });

		const markers = [...blockHostAt(mounted, [0]).querySelectorAll('.md-marker')];

		expect(markers.map((m) => m.textContent)).toEqual(['- ']);
		expect(ambientSpanOf(surfaceAt(mounted, [0, 0, 0, 0, 0]))?.textContent).toBe('- ');
		expect(mounted.source()).toBe('- - a\n');
	});

	// Forwarding is to child 0 ONLY: a second child of the same item paints nothing,
	// or the marker would repeat down every line of a multi-block item.
	it('forwards to child 0 only', () => {
		mounted = mountEditor({ source: '- alpha\n\n  beta\n' });

		expect(ambientSpanOf(surfaceAt(mounted, [0, 0, 0]))?.textContent).toBe('- ');
		expect(ambientSpanOf(surfaceAt(mounted, [0, 0, 1]))).toBeNull();
	});
});
