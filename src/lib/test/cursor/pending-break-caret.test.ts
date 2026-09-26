// @vitest-environment jsdom
//
// A pending hard break's two anchors start a line of their own, between the break's hidden
// backslash and whatever hidden run follows (a setext underline), so a caret at the break sits at
// that line's start and reads back as the same raw offset.
// Miss-analysis: every pending break the suite built ended its block, so no hidden run followed
// the anchors and the walk merged the two runs into one the caret could not stop inside.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { placeCaretAtRaw, rawSelectionFocus } from '$lib/cursor/widget-offset';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

function mountLive(source: string): HTMLElement {
	const el = surfaceAt(mountEditor({ source, presentationMode: 'live' }), [0]);
	el.focus();
	return el;
}

function placed(el: HTMLElement, raw: number) {
	placeCaretAtRaw(el, raw, { clamp: 'exact' });
	const sel = window.getSelection()!;
	return { raw: rawSelectionFocus(el), node: sel.focusNode, offset: sel.focusOffset };
}

describe('live mode: a caret at a pending hard break', () => {
	it('before a setext underline, sits between the anchors and reads back as the break', () => {
		const el = mountLive('Plan\\\n===\n');

		expect(placed(el, 5)).toEqual({ raw: 5, node: el, offset: 3 });
	});

	// The hidden underline is one run the caret cannot enter, so a place inside it moves past it.
	it.each([
		[0, 0],
		[4, 4],
		[6, 9],
		[9, 9]
	])('before a setext underline, raw %i reads back as %i', (raw, readBack) => {
		expect(placed(mountLive('Plan\\\n===\n'), raw).raw).toBe(readBack);
	});

	it('ending the block, sits between the anchors as before', () => {
		const el = mountLive('Plan\\\n');

		expect(placed(el, 5)).toEqual({ raw: 5, node: el, offset: 3 });
	});
});
