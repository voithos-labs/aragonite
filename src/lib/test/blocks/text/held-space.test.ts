// @vitest-environment jsdom
// A space typed at a hidden closer is written past it while the caret still means inside: the next
// letter takes the space back in with it, on every route, and a move or a named side ends that.
// Miss-analysis: every edge row typed a letter, never whitespace, the one byte a closer can't
// follow, so nothing saw the space carry the caret out of the construct.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import { INSERTION_ROUTES, insertBy } from '$lib/test/harness/insertion-routes';
import type { PresentationMode } from '$lib/presentation-mode';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** `source` mounted in `mode` with the caret at `at`. */
function caretIn(source: string, at: number, mode: PresentationMode = 'live') {
	const editor = mountEditor({ source, presentationMode: mode });
	const el = surfaceAt(editor, [0]);
	placeCaret(el, at);
	return { editor, el };
}

describe.each(['**', '*', '_', '~~'])('a new %s pair', (delimiter) => {
	const source = `a ${delimiter}two${delimiter}\n`;
	const inside = 2 + delimiter.length + 3;

	it.each(INSERTION_ROUTES)(
		'keeps a space and the next letter inside, typed by %s',
		async (route) => {
			const { editor, el } = caretIn(source, inside);

			await insertBy(route, el, ' ');
			expect(editor.source()).toBe(`a ${delimiter}two${delimiter} \n`);
			await insertBy(route, el, 'w');

			expect(editor.source()).toBe(`a ${delimiter}two w${delimiter}\n`);
		}
	);
});

describe('typing on after an existing bold', () => {
	it('a click at its end, then a space and a word, extends it', async () => {
		const { editor, el } = caretIn('**bold**\n', 6);

		await insertBy('hardware key', el, ' more');

		expect(editor.source()).toBe('**bold more**\n');
	});

	// The space typed mid-line sits beside the line's own, so the run fits at two offsets.
	it('mid-line, a click at its end, then a space and a word, extends it', async () => {
		const { editor, el } = caretIn('Some **bold** text\n', 11);

		await insertBy('hardware key', el, ' more');

		expect(editor.source()).toBe('Some **bold more** text\n');
	});

	it('a second space keeps the hold', async () => {
		const { editor, el } = caretIn('a **two**\n', 7);

		await insertBy('hardware key', el, '  w');

		expect(editor.source()).toBe('a **two  w**\n');
	});

	it('an arrival from outside types the space and the word outside', async () => {
		const { editor, el } = caretIn('**bold**\n', 8);
		await pressKey(el, { key: 'ArrowLeft' });

		await insertBy('hardware key', el, ' more');

		expect(editor.source()).toBe('**bold** more\n');
	});

	it('the format chord before the space types outside', async () => {
		const { editor, el } = caretIn('**bold**\n', 6);
		await pressKey(el, { key: 'b', ctrlKey: true });

		await insertBy('hardware key', el, ' more');

		expect(editor.source()).toBe('**bold** more\n');
	});

	it('an arrow step back inside, where the ring shows, types the space and the word inside', async () => {
		const { editor, el } = caretIn('a **bold**\n', 8);
		await pressKey(el, { key: 'ArrowRight' });
		await pressKey(el, { key: 'ArrowLeft' });

		await insertBy('hardware key', el, ' w');

		expect(editor.source()).toBe('a **bold w**\n');
	});
});

/** The ways out of a held space Finn asked for: one arrow, End, the closer, the format chord. */
const EXITS: [string, KeyboardEventInit][] = [
	['ArrowRight', { key: 'ArrowRight' }],
	['the typed closer', { key: '*' }],
	['the format chord', { key: 'b', ctrlKey: true }]
];

describe.each(EXITS)('%s ends the hold, and the next letter lands outside', (_name, exit) => {
	it('at the line’s end', async () => {
		const { editor, el } = caretIn('a **two**\n', 7);
		await insertBy('hardware key', el, ' ');

		await (exit.key === '*' ? insertBy('hardware key', el, '*') : pressKey(el, exit));
		await insertBy('hardware key', el, 'w');

		expect(editor.source()).toBe('a **two** w\n');
	});

	it('mid-line', async () => {
		const { editor, el } = caretIn('a **two** b\n', 7);
		await insertBy('hardware key', el, ' ');
		expect(editor.source()).toBe('a **two**  b\n');

		await (exit.key === '*' ? insertBy('hardware key', el, '*') : pressKey(el, exit));
		await insertBy('hardware key', el, 'w');

		expect(editor.source()).toBe('a **two** w b\n');
	});
});

describe('the hold ends without touching the bytes', () => {
	it('End at the line’s end', async () => {
		const { editor, el } = caretIn('a **two**\n', 7);
		await insertBy('hardware key', el, ' ');

		await pressKey(el, { key: 'End' });
		await insertBy('hardware key', el, 'w');

		expect(editor.source()).toBe('a **two** w\n');
	});

	it('a click away leaves `a **two** ` as it is', async () => {
		const editor = mountEditor({ source: 'a **two**\n\nnext\n', presentationMode: 'live' });
		const el = surfaceAt(editor, [0]);
		placeCaret(el, 7);
		await insertBy('hardware key', el, ' ');

		placeCaret(surfaceAt(editor, [1]), 2);
		surfaceAt(editor, [1]).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		await editor.settle();
		expect(editor.source()).toBe('a **two** \n\nnext\n');

		placeCaret(el, 10);
		await insertBy('hardware key', el, 'w');
		expect(editor.source()).toBe('a **two** w\n\nnext\n');
	});

	it('source mode writes every byte where the caret shows it', async () => {
		const { editor, el } = caretIn('a **two**\n', 7, 'source');

		await insertBy('hardware key', el, ' w');

		expect(editor.source()).toBe('a **two w**\n');
	});
});
