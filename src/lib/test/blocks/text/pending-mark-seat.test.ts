// @vitest-environment jsdom
// A format chord at a hidden edge reads where the next letter would land, not the raw caret: the
// chord at the end of a bold takes the bold off, whichever side of the closer the caret holds.
// Miss-analysis: every pending-mark row placed the caret inside the closer, so none saw a caret
// normalised past it pend an application of the mark it was meant to remove.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { TEXT_HOSTS, insertBy, type InsertionRoute } from '#lib/test/harness/insertion-routes.js';
import {
	caretMarks,
	installDrawnCaretStubs,
	paintCaret,
	type DrawnCaretSeam
} from '#lib/test/harness/drawn-caret-jsdom.js';

let restoreStubs: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreStubs = installDrawnCaretStubs();
});
afterAll(() => restoreStubs());
afterEach(destroyMountedEditors);

// `Some **bold** text`: the closer is [11, 13), so 11 and 13 are one screen position.
const LINE = 'Some **bold** text';
const OFFSETS = [11, 13];

/** Pending marks are spent by these two; the rest are a separate gap. */
const SPENDING_ROUTES: InsertionRoute[] = ['hardware key', 'composition'];

describe.each(TEXT_HOSTS)('the bold chord at the end of a bold, in $name', (host) => {
	async function chordAt(at: number) {
		const editor = mountEditor<DrawnCaretSeam>({
			source: host.source(LINE),
			presentationMode: 'live'
		});
		const el = host.el(editor);
		placeCaret(el, at);
		await pressKey(el, { key: 'b', ctrlKey: true });
		return { editor, el };
	}

	it.each(OFFSETS)('paints plain before any letter, from %i', async (at) => {
		const { editor } = await chordAt(at);
		await paintCaret(editor);
		expect(caretMarks(editor)).toEqual([]);
	});

	describe.each(SPENDING_ROUTES)('typed by %s', (route) => {
		it.each(OFFSETS)('types the letter plain, from %i', async (at) => {
			const { editor, el } = await chordAt(at);
			await insertBy(route, el, 'X');
			expect(host.line(editor.source())).toBe('Some **bold**X text');
		});
	});
});
