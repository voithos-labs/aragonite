// @vitest-environment jsdom
// The caret at a pending hard break sits on the line the break opens, between its anchors, and reads
// back as the text's end: while the break is open, the end of the line above is no caret position.
// Miss-analysis: every pending break the suite built ended its block, so no hidden run followed.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { rawSelectionFocus } from '#lib/caret/widget-offset.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

async function openBreakAt(source: string, at: number, mode: 'source' | 'live') {
	const editor = mountEditor({ source, presentationMode: mode });
	await pressKeyAt(editor, [0], at, { key: 'Enter', shiftKey: true });
	return surfaceAt(editor, [0]);
}

function placed(el: HTMLElement, raw: number) {
	testCaretWriter.placeCaretAtRaw(el, raw, { clamp: 'exact' });
	const sel = window.getSelection()!;
	return { raw: rawSelectionFocus(el), node: sel.focusNode, offset: sel.focusOffset };
}

/** The DOM spelling of "just before the last break anchor": the line the break opens. */
function onPendingLine(el: HTMLElement) {
	const anchors = [...el.querySelectorAll('br[data-caret-anchor="break"]')];
	return { node: el, offset: [...el.childNodes].indexOf(anchors[anchors.length - 1]) };
}

describe.each(['source', 'live'] as const)('%s mode: a caret at a pending hard break', (mode) => {
	it('ending the block, sits on the new line and reads back as the text’s end', async () => {
		const el = await openBreakAt('Plan\n', 4, mode);

		expect(placed(el, 4)).toEqual({ raw: 4, ...onPendingLine(el) });
	});

	it('before a setext underline, sits on the new line', async () => {
		const el = await openBreakAt('Plan\n===\n', 4, mode);

		expect(placed(el, 4)).toEqual({ raw: 4, ...onPendingLine(el) });
	});

	it('is where Shift+Enter leaves it', async () => {
		const el = await openBreakAt('Plan\n', 4, mode);

		const sel = window.getSelection()!;
		expect({ node: sel.focusNode, offset: sel.focusOffset }).toEqual(onPendingLine(el));
	});
});

describe('live mode: a pending break before a hidden underline', () => {
	// The hidden underline is one run the caret cannot enter, so a place inside it moves past it.
	it.each([
		[0, 0],
		[6, 8],
		[8, 8]
	])('raw %i reads back as %i', async (raw, readBack) => {
		const el = await openBreakAt('Plan\n===\n', 4, 'live');

		expect(placed(el, raw).raw).toBe(readBack);
	});
});
