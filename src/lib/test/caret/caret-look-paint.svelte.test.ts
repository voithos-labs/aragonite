// @vitest-environment jsdom
// The drawn caret paints its look on the press that changes it, a key that moves no caret
// included, and the look holds through a space typed at a hidden closer.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { TEXT_HOSTS, insertBy } from '#lib/test/harness/insertion-routes.js';
import {
	caretMarks,
	installDrawnCaretStubs,
	paintCaret,
	runCaretFrames,
	type DrawnCaretSeam
} from '#lib/test/harness/drawn-caret-jsdom.js';
import type { CaretLook } from '#lib/caret/caret-look.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

let restoreStubs: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreStubs = installDrawnCaretStubs();
	enablePerfInstruments();
});
afterAll(() => {
	restoreStubs();
	disablePerfInstruments();
});
beforeEach(resetPerfInstruments);
afterEach(destroyMountedEditors);

/** `line` in `host`, live, with the caret painted at `at`. */
async function liveAt(host: (typeof TEXT_HOSTS)[number], line: string, at: number) {
	const editor = mountEditor<DrawnCaretSeam>({
		source: host.source(line),
		presentationMode: 'live'
	});
	const el = host.el(editor);
	placeCaret(el, at);
	await paintCaret(editor);
	return { editor, el };
}

const bar = (editor: { target: HTMLElement }) =>
	editor.target.querySelector<HTMLElement>('.md-drawn-caret')!;

describe.each(TEXT_HOSTS)('a space held at a hidden closer, in $name', (host) => {
	it.each([
		['bold', 'a **bold** b', 8, ['strong'], 'a **bold w** b'],
		['strikethrough', 'a ~~gone~~ b', 8, ['strikethrough'], 'a ~~gone w~~ b']
	])('in %s, paints the mark and the next letter takes it', async (_n, line, at, marks, typed) => {
		const { editor, el } = await liveAt(host, line, at);

		await insertBy('hardware key', el, ' ');
		expect(caretMarks(editor), 'the look after the space').toEqual(marks);

		await insertBy('hardware key', el, 'w');
		expect(host.line(editor.source())).toBe(typed);
	});
});

describe('a key that moves no caret repaints the look in its own task', () => {
	it('the bold chord at a bold’s end, from bold to plain', async () => {
		const { editor, el } = await liveAt(TEXT_HOSTS[0], 'a **bold** b', 8);
		const inside = caretMarks(editor);
		resetPerfInstruments();

		await pressKey(el, { key: 'b', ctrlKey: true });

		expect(perfSnapshot().caretPaints, 'paints before any frame').toBeGreaterThan(0);
		expect(caretMarks(editor), 'outside').toEqual([]);
		expect(inside, 'inside').toEqual(['strong']);
	});

	it('the bold chord at a plain caret, before any letter', async () => {
		const { editor, el } = await liveAt(TEXT_HOSTS[0], 'b c', 1);
		resetPerfInstruments();

		await pressKey(el, { key: 'b', ctrlKey: true });

		expect(perfSnapshot().caretPaints, 'paints before any frame').toBeGreaterThan(0);
		expect(caretMarks(editor)).toEqual(['strong']);
		expect(editor.source()).toBe('b c\n');
	});

	it('restarts the blink, so the new shape shows solid', async () => {
		const { editor, el } = await liveAt(TEXT_HOSTS[0], 'a **bold** b', 8);
		const blink = bar(editor).getAttribute('data-blink');

		await pressKey(el, { key: 'b', ctrlKey: true });

		expect(bar(editor).getAttribute('data-blink')).not.toBe(blink);
	});
});

describe('a repaint that changes nothing', () => {
	it('writes no attribute on the bar', async () => {
		const { editor } = await liveAt(TEXT_HOSTS[0], 'a **bold** b', 6);
		const written: string[] = [];
		const record = (records: MutationRecord[]) =>
			written.push(...records.map((r) => r.attributeName ?? '?'));
		const watch = new MutationObserver(record);
		watch.observe(bar(editor), { attributes: true });

		await paintCaret(editor);
		record(watch.takeRecords());
		watch.disconnect();

		expect(written).toEqual([]);
		expect(caretMarks(editor)).toEqual(['strong']);
	});
});

describe('a frame paint that finds only a new look', () => {
	it('counts no caret move, since the caret stayed where it was', async () => {
		const { editor, el } = await liveAt(TEXT_HOSTS[0], 'a **bold** b', 6);
		let look: CaretLook = { marks: ['strong'] };
		const caret = editor.instance.__test.getDrawnCaret();
		const unregister = caret.register({ el, drawable: () => true, look: () => look });
		await paintCaret(editor);
		look = { marks: [] };
		resetPerfInstruments();

		window.dispatchEvent(new Event('focus'));
		runCaretFrames();
		unregister();

		expect(caretMarks(editor), 'the frame painted the new look').toEqual([]);
		expect(perfSnapshot().caretFrameMoves).toBe(0);
	});
});
