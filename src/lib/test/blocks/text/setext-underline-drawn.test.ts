// @vitest-environment jsdom
//
// A setext heading draws its underline as a marker, hidden where markers hide, and every key at
// the title's end keeps the underline under the title (GH #463, #468).
// Miss-analysis: the page never drew the underline, so each write route put it back on its own,
// and the key routes that splice the displayed text (Shift+Enter, Tab) had no setext case.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import { landableRawBounds } from '$lib/cursor/widget-offset';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('the underline is on the page', () => {
	it.each(['source', 'live'] as const)('%s mode draws it as a marker after the title', (mode) => {
		const mounted = mountEditor({ source: 'Plan\n===\n', presentationMode: mode });
		const el = surfaceAt(mounted, [0]);

		expect(el.textContent).toBe('Plan\n===');
		expect(el.lastElementChild?.classList.contains('md-marker')).toBe(true);
		expect(el.lastElementChild?.textContent).toBe('\n===');
	});

	// Source mode paints the underline, so the caret may go there to edit it, as it may into a `#`.
	it('keeps the caret out of the underline only where markers hide', () => {
		const live = mountEditor({ source: 'Plan\n===\n', presentationMode: 'live' });
		expect(landableRawBounds(surfaceAt(live, [0]))).toEqual({ start: 0, end: 4 });

		const source = mountEditor({ source: 'Plan\n===\n', presentationMode: 'source' });
		expect(landableRawBounds(surfaceAt(source, [0]))).toBeNull();
	});
});

describe.each(['source', 'live'] as const)(
	'%s mode: a key at the end of a setext title',
	(mode) => {
		it('Shift+Enter keeps the heading, and the next key starts its second line', async () => {
			const mounted = mountEditor({ source: 'Plan\n===\n', presentationMode: mode });

			await pressKeyAt(mounted, [0], 4, { key: 'Enter', shiftKey: true });
			await mounted.settle();
			expect(mounted.source()).toBe('Plan\\\n===\n');

			await pressKey(surfaceAt(mounted, [0]), { key: 'x' });
			await mounted.settle();
			expect(mounted.source()).toBe('Plan\\\nx\n===\n');
		});

		it('Tab writes its tab before the underline', async () => {
			const mounted = mountEditor({ source: 'Plan\n===\n', presentationMode: mode });

			await pressKeyAt(mounted, [0], 4, { key: 'Tab' });
			await mounted.settle();
			expect(mounted.source()).toBe('Plan\t\n===\n');
		});
	}
);
