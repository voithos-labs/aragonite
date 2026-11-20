// @vitest-environment jsdom
// A pending mark belongs to the next insertion, whatever route writes it: a key, a soft keyboard, an
// autocorrect replacement, an IME commit or a paste, in a paragraph and in a table cell.
// Miss-analysis: the pending-mark rows typed only by a hardware key or a composition, the two routes
// that read the marks themselves, so a route that reaches only the block's write never met one.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	INSERTION_ROUTES,
	TEXT_HOSTS,
	dropAtCaret,
	insertBy
} from '#lib/test/harness/insertion-routes.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const BOLD: KeyboardEventInit = { key: 'b', ctrlKey: true };
const ITALIC: KeyboardEventInit = { key: 'i', ctrlKey: true };

describe.each(TEXT_HOSTS)('in $name', (host) => {
	/** `line` in live mode, the caret at `at`, each chord pressed in turn. */
	async function chorded(line: string, at: number, ...chords: KeyboardEventInit[]) {
		const editor = mountEditor({ source: host.source(line), presentationMode: 'live' });
		const el = host.el(editor);
		placeCaret(el, at);
		for (const chord of chords) await pressKey(el, chord);
		return { editor, el };
	}

	describe.each(INSERTION_ROUTES)('typed by %s', (route) => {
		it('the bold chord wraps the insertion', async () => {
			const { editor, el } = await chorded('plain', 5, BOLD);
			await insertBy(route, el, 'X');
			expect(host.line(editor.source())).toBe('plain**X**');
		});

		it('two chords nest both marks around it', async () => {
			const { editor, el } = await chorded('plain', 5, BOLD, ITALIC);
			await insertBy(route, el, 'X');
			expect(host.line(editor.source())).toBe('plain***X***');
		});

		it('the chord inside a bold takes the bold off', async () => {
			const { editor, el } = await chorded('**ab**', 3, BOLD);
			await insertBy(route, el, 'X');
			expect(host.line(editor.source())).toBe('**a**X**b**');
		});

		// The mark applies where the letter lands: inside the bold the character before it is in, or
		// past it once a typed closer said outside.
		it('the italic chord at a bold’s end marks the letter inside the bold', async () => {
			const { editor, el } = await chorded('Some **bold** text', 11, ITALIC);
			await insertBy(route, el, 'X');
			expect(host.line(editor.source())).toBe('Some **bold*X*** text');
		});

		// A space at a closer is written past it, but the chord asked about the letter's side. A cell
		// writes nothing for a paste of whitespace alone, chord or not.
		const pastesSpace = route !== 'paste' || host.name !== 'a table cell';
		it.runIf(pastesSpace)('the bold chord at a bold’s end types a space outside', async () => {
			const { editor, el } = await chorded('**bold** end', 6, BOLD);
			await insertBy(route, el, ' ');
			await insertBy('hardware key', el, 'more');
			expect(host.line(editor.source())).toBe('**bold** more end');
		});

		it('after a typed closer, the italic chord marks the letter past the bold', async () => {
			const { editor, el } = await chorded('Some **bold** text', 11);
			await insertBy('hardware key', el, '**');
			await pressKey(el, ITALIC);
			await insertBy(route, el, 'X');
			expect(host.line(editor.source())).toBe('Some **bold***X* text');
		});

		it('one insertion spends the mark, and the next extends what it made', async () => {
			const { editor, el } = await chorded('plain', 5, BOLD);
			await insertBy(route, el, 'X');
			await insertBy('hardware key', el, 'y');
			expect(host.line(editor.source())).toBe('plain**Xy**');
		});
	});

	// A cancelled IME run writes nothing, so the promise is still owed.
	it('a composition that commits nothing leaves the mark for the next insertion', async () => {
		const { editor, el } = await chorded('plain', 5, BOLD);
		await insertBy('composition', el, '');
		await insertBy('hardware key', el, 'X');
		expect(host.line(editor.source())).toBe('plain**X**');
	});

	// A drop lands at the pointer, which is a new caret, so the mark the caret held goes unspent.
	it('a drop types plain, and so does the key after it', async () => {
		const { editor, el } = await chorded('plain', 5, BOLD);
		await dropAtCaret(el, 'X');
		await insertBy('hardware key', el, 'y');
		expect(host.line(editor.source())).toBe('plainXy');
	});
});

// The mark wraps the insertion, and the break the open line waits on goes in ahead of both.
describe.each(INSERTION_ROUTES)(
	'the bold chord on the line Shift+Enter opened, typed by %s',
	(route) => {
		it('writes the break, then the wrapped insertion', async () => {
			const editor = mountEditor({ source: 'abc\n', presentationMode: 'live' });
			const el = surfaceAt(editor, [0]);
			placeCaret(el, 3);
			await pressKey(el, { key: 'Enter', shiftKey: true });
			await pressKey(el, BOLD);

			await insertBy(route, el, 'X');

			expect(editor.source()).toBe('abc\\\n**X**\n');
		});
	}
);

// The core lands two line endings mid-text twice (tried as Enter, then as pasted); the mark is
// spent once, so the landing it keeps wraps the text too.
it('a paste ending in two line breaks mid-text keeps the bold chord’s mark', async () => {
	const editor = mountEditor({ source: 'plain\n', presentationMode: 'live' });
	const el = surfaceAt(editor, [0]);
	placeCaret(el, 3);
	await pressKey(el, BOLD);
	await insertBy('paste', el, 'XY\n\n');
	expect(editor.source()).toBe('pla**XY**\n\nin\n');
});

// A drop drops only the marks: the open line waits at one place, and a drop landing there is its
// insertion. Miss-analysis: the drop row ran at a plain caret, so no row saw a drop lose the break.
it('a drop onto the line Shift+Enter opened writes the break, without the chord’s mark', async () => {
	const editor = mountEditor({ source: 'abc\n', presentationMode: 'live' });
	const el = surfaceAt(editor, [0]);
	placeCaret(el, 3);
	await pressKey(el, { key: 'Enter', shiftKey: true });
	await pressKey(el, BOLD);

	await dropAtCaret(el, 'X');

	expect(editor.source()).toBe('abc\\\nX\n');
});
