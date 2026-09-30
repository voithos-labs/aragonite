// @vitest-environment jsdom
// An ATX heading's closing `#` run (GFM §4.2) is drawn as a marker after the text, hidden where
// markers hide, and the keys at the content's end keep it after the text.
// Miss-analysis: no heading render test had a closing run, so drawing it as heading text passed.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { landableRawBounds } from '$lib/cursor/widget-offset';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('the closing run is on the page', () => {
	it.each(['source', 'live'] as const)('%s mode draws it as a marker after the text', (mode) => {
		const mounted = mountEditor({ source: '# Hi #\n', presentationMode: mode });
		const el = surfaceAt(mounted, [0]);

		expect(el.textContent).toBe('# Hi #');
		expect(el.lastElementChild?.classList.contains('md-marker')).toBe(true);
		expect(el.lastElementChild?.textContent).toBe(' #');
	});

	it('keeps the caret out of the closing run where markers hide', () => {
		const live = mountEditor({ source: '# Hi #\n', presentationMode: 'live' });
		expect(landableRawBounds(surfaceAt(live, [0]))).toEqual({ start: 2, end: 4 });
	});
});

/** Type `text` the way the browser would, before the drawn closing run, and fire the input. */
async function typeBeforeClosingRun(mounted: MountedEditor, text: string): Promise<void> {
	const el = surfaceAt(mounted, [0]);
	el.focus();
	el.insertBefore(document.createTextNode(text), el.lastElementChild);
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
	await mounted.settle();
}

describe.each(['source', 'live'] as const)('%s mode: keys at the text', (mode) => {
	it('typing at the end of the text keeps the closing run after it', async () => {
		const mounted = mountEditor({ source: '# Hi #\n', presentationMode: mode });

		await typeBeforeClosingRun(mounted, 'x');
		expect(mounted.source()).toBe('# Hix #\n');
	});

	it('a heading level chord rewrites the marker and drops the closing run', async () => {
		const mounted = mountEditor({ source: '# Hi #\n', presentationMode: mode });

		await pressKeyAt(mounted, [0], 3, { key: '2', ctrlKey: true });
		await mounted.settle();
		expect(mounted.source()).toBe('## Hi\n');
	});
});

describe('live mode: Backspace at the start of the text', () => {
	it('demotes to the paragraph the text reads as, closing run and all', async () => {
		const mounted = mountEditor({ source: '# Hi #\n', presentationMode: 'live' });

		await pressKeyAt(mounted, [0], 2, { key: 'Backspace' });
		await mounted.settle();
		expect(mounted.source()).toBe('Hi\n');
	});
});
