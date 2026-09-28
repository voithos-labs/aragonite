// @vitest-environment jsdom
// Backspace at the start of a definition's body unwraps the note, the way every other
// marker-bearing container does. The marker lives in metadata, so what is left after a lift
// is still a definition rather than the blockquote a quote lift leaves.
// Miss-analysis: no test asserted what Backspace did, only that the bytes stayed unchanged.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { installLayoutStubs, mountEditor, pressKeyAt } from '$lib/test/harness/mount-editor.svelte';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;

afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const BACKSPACE = { key: 'Backspace' };

function editor(source: string): ReturnType<typeof mountEditor> {
	mounted = mountEditor({ source, plugins: [footnotesPlugin()] });
	return mounted;
}

describe('footnote definition Backspace unwrap', () => {
	it('unwraps a single-paragraph note into a bare paragraph', async () => {
		editor('[^a]: First note.\n');

		await pressKeyAt(mounted, [0, 0], 0, BACKSPACE);

		expect(mounted.source()).toBe('First note.\n');
	});

	it('lifts the first body block out and leaves the rest under the marker', async () => {
		editor('[^a]: First.\n\n    Second.\n');

		await pressKeyAt(mounted, [0, 0], 0, BACKSPACE);

		expect(mounted.source()).toBe('First.\n\n[^a]: Second.\n');
	});

	it('merges a second body block into the first instead of unwrapping', async () => {
		editor('[^a]: First.\n\n    Second.\n');

		await pressKeyAt(mounted, [0, 1], 0, BACKSPACE);

		expect(mounted.source()).toBe('[^a]: First.Second.\n');
	});

	// The edit itself is the browser's; the case asserts only that no unwrap branch took it.
	it('leaves a mid-content Backspace to the block itself', async () => {
		editor('[^a]: First note.\n');

		await pressKeyAt(mounted, [0, 0], 5, BACKSPACE);

		expect(mounted.source()).toBe('[^a]: First note.\n');
	});

	// Where the caret lands tells a deliberate decline from a keystroke that did nothing; a note
	// acts as one block from outside, so the paragraph below never becomes note text.
	it('declines the paragraph below it and lands the caret at the note body end', async () => {
		editor('[^a]: First note.\n\nAfter.\n');

		await pressKeyAt(mounted, [1], 0, BACKSPACE);

		expect(mounted.source()).toBe('[^a]: First note.\n\nAfter.\n');
		expect(mounted.instance.getSelection()?.focus).toEqual({ path: [0, 0], offset: 11 });
	});
});
