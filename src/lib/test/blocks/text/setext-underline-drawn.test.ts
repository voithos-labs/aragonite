// @vitest-environment jsdom
// A setext heading draws its underline as a marker, hidden where markers hide, and every key at
// the title's end keeps the underline under the title.
// Miss-analysis: GH #463, #468, no setext case covered Shift+Enter or Tab at the title's end.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	pressKeyAt,
	selectRange,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { reachableRawBounds } from '#lib/browser/offsets.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

// Miss-analysis: no test checked a setext heading's class, so it read the level through the ATX
// heading's metadata, which only happens to share the `level` field.
it.each([
	['Plan\n===\n', 'heading-1'],
	['Plan\n---\n', 'heading-2']
])('the setext heading %j draws with %s', (source, headingClass) => {
	const mounted = mountEditor({ source });
	expect(surfaceAt(mounted, [0]).classList.contains(headingClass)).toBe(true);
});

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
		expect(reachableRawBounds(surfaceAt(live, [0]))).toEqual({ start: 0, end: 4 });

		const source = mountEditor({ source: 'Plan\n===\n', presentationMode: 'source' });
		expect(reachableRawBounds(surfaceAt(source, [0]))).toBeNull();
	});
});

// Where markers hide, the underline is on the page but not on screen, so no range the user drew
// can have meant to remove it.
describe('live mode: a range that runs to the block end stops at the title', () => {
	function beforeInput(el: HTMLElement, inputType: string, data: string | null = null): void {
		el.dispatchEvent(
			new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
		);
	}

	it.each([
		['typing over the whole block', 0, 'insertText', 'x', 'x\n===\n'],
		['deleting to the block end', 2, 'deleteContentBackward', null, 'Pl\n===\n']
	])('%s keeps the underline', async (_label, from, inputType, data, written) => {
		const mounted = mountEditor({ source: 'Plan\n===\n', presentationMode: 'live' });
		const el = surfaceAt(mounted, [0]);
		selectRange(el, from, 8);

		beforeInput(el, inputType, data);
		await mounted.settle();

		expect(mounted.source()).toBe(written);
	});

	it('the first select-all selects the title alone', async () => {
		const mounted = mountEditor({ source: 'Plan\n===\n', presentationMode: 'live' });
		const el = surfaceAt(mounted, [0]);
		placeCaret(el, 2);

		await pressKey(el, { key: 'a', ctrlKey: true });

		const range = window.getSelection()!.getRangeAt(0);
		expect(range.toString()).toBe('Plan');
	});
});

describe.each(['source', 'live'] as const)(
	'%s mode: a key at the end of a setext title',
	(mode) => {
		it('Shift+Enter keeps the heading, and the next key starts its second line', async () => {
			const mounted = mountEditor({ source: 'Plan\n===\n', presentationMode: mode });

			await pressKeyAt(mounted, [0], 4, { key: 'Enter', shiftKey: true });
			await mounted.settle();
			// Nothing is written until the next key.
			expect(mounted.source()).toBe('Plan\n===\n');

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
