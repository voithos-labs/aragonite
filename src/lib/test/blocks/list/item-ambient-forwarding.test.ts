// @vitest-environment jsdom
//
// A list item's marker is not in its own bytes: it is a prefix handed to `BlockList` as
// `ambientPrefixForFirst`, passed on to child 0 only, and drawn only by a prose block. So when
// child 0 is a nested list (`- - a`) the outer marker has nowhere to go and is silently dropped.
// That is deliberate, and exactly the kind of behaviour a well-meaning fix restores, so it is
// measured against a control case through the same `ambientSpanOf` helper.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { ambientSpanOf } from '$lib/ambient/ambient-dom';
import {
	installLayoutStubs,
	mountEditor,
	blockHostAt,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';

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

	// The deliberate drop: child 0 is a list, which takes no `ambientPrefix` prop, so the outer
	// `- ` never reaches the DOM, leaving one marker rendered for the two the source carries.
	it('drops the marker when child 0 is a nested list rather than a prose leaf', () => {
		mounted = mountEditor({ source: '- - a\n' });

		const markers = [...blockHostAt(mounted, [0]).querySelectorAll('.md-marker')];

		expect(markers.map((m) => m.textContent)).toEqual(['- ']);
		expect(ambientSpanOf(surfaceAt(mounted, [0, 0, 0, 0, 0]))?.textContent).toBe('- ');
		expect(mounted.source()).toBe('- - a\n');
	});

	// It is passed to child 0 only: a second child of the same item draws nothing,
	// or the marker would repeat down every line of a multi-block item.
	it('forwards to child 0 only', () => {
		mounted = mountEditor({ source: '- alpha\n\n  beta\n' });

		expect(ambientSpanOf(surfaceAt(mounted, [0, 0, 0]))?.textContent).toBe('- ');
		expect(ambientSpanOf(surfaceAt(mounted, [0, 0, 1]))).toBeNull();
	});
});
