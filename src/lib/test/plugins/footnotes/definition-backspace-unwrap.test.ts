// @vitest-environment jsdom
//
// Backspace at the start of a definition's body unwraps the note, the way every other
// marker-bearing container does. The marker rides metadata, so the remainder of a lift is
// still a definition rather than the blockquote a quote-shaped lift leaves.
//
// Miss-analysis: the descriptor declared no `unwrapRole`, so the keystroke delegated upward
// and became a focus move: a no-op no test asserted, because the suite only ever checked that
// the bytes were unchanged after edits that were supposed to change nothing.
import { describe, it, expect, afterEach, beforeEach, beforeAll } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../../blocks/editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;

beforeEach(() => {
	resetPluginPlatformForTests();
});

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

	// The native edit is the browser's; what this asserts is that no unwrap arm claimed it.
	it('leaves a mid-content Backspace to the block itself', async () => {
		editor('[^a]: First note.\n');

		await pressKeyAt(mounted, [0, 0], 5, BACKSPACE);

		expect(mounted.source()).toBe('[^a]: First note.\n');
	});

	// The bytes are half the assertion: the caret landing is what tells a decline from a
	// keystroke that died. A note is leaf-like outward, so body text never becomes note text.
	it('declines the paragraph below it and lands the caret at the note body end', async () => {
		editor('[^a]: First note.\n\nAfter.\n');

		await pressKeyAt(mounted, [1], 0, BACKSPACE);

		expect(mounted.source()).toBe('[^a]: First note.\n\nAfter.\n');
		expect(mounted.instance.getSelection()?.focus).toEqual({ path: [0, 0], offset: 11 });
	});
});
