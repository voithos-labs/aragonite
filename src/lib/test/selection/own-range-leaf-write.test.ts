// @vitest-environment jsdom
// Text typed or composed over a range inside one block leaves the same bytes whoever holds the
// range, a finger's or the browser's: the block's own write over the range, markers kept.
// Miss-analysis: the finger's range was tested on a plain word, where removing first and typing
// after lands the same, and no row typed over a whole text inside markers or under structure.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	mountCase,
	placeOwnedRange,
	placeRange,
	typeGesture,
	type TypingRoute
} from '#lib/test/range-laws/gestures.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const at = (path: number[], from: number, to: number) => ({
	anchor: { path, offset: from },
	focus: { path, offset: to }
});

/** A source, the range inside one block, the modes it reads the same in, and the bytes `Q` typed
 *  over it leaves. */
const ROWS: [string, string, ReturnType<typeof at>, PresentationMode[], string][] = [
	[
		'a heading’s whole text',
		'# head\n\nnext\n',
		at([0], 2, 6),
		['live', 'source'],
		'# Q\n\nnext\n'
	],
	['a bold run’s whole text', 'a **bold** c\n', at([0], 4, 8), ['live'], 'a **Q** c\n'],
	['an italic run’s whole text', 'a *ital* c\n', at([0], 3, 7), ['live'], 'a *Q* c\n'],
	['a code span’s whole text', 'a `code` c\n', at([0], 3, 7), ['live'], 'a `Q` c\n'],
	[
		'a setext heading’s text',
		'heading\n====\n\nnext\n',
		at([0], 0, 7),
		['live', 'source'],
		'Q\n====\n\nnext\n'
	],
	[
		'a callout body’s only paragraph',
		':::tip\nin\n:::\n',
		at([0, 1], 0, 2),
		['live', 'source'],
		':::tip\nQ\n:::\n'
	],
	[
		'the last paragraph with no final break',
		'above\n\npara',
		at([1], 0, 4),
		['live', 'source'],
		'above\n\nQ'
	],
	['a range through a link’s close', '[a](b) c d\n', at([0], 2, 8), ['live'], '[a](b)Q d\n'],
	['a word', 'alpha bravo charlie\n', at([0], 6, 11), ['live', 'source'], 'alpha Q charlie\n'],
	[
		'a paragraph’s whole text between blocks',
		'above\n\npara\n\nbelow\n',
		at([1], 0, 4),
		['live', 'source'],
		'above\n\nQ\n\nbelow\n'
	]
];

const HOLDERS = [
	['the browser’s range', placeRange],
	['a finger’s range', placeOwnedRange]
] as const;

const KEYS: TypingRoute[] = ['hardware key', 'soft key'];

describe('a key over a range inside one block writes what the block writes', () => {
	for (const [name, source, range, modes, typed] of ROWS)
		for (const mode of modes)
			for (const [holder, place] of HOLDERS)
				for (const route of KEYS)
					it(`${name}, ${route}, ${holder}, ${mode}`, async () => {
						const editor = mountCase(source, mode);
						await editor.settle();
						expect(await place(editor, range)).toBe(true);
						await typeGesture(editor, { text: 'Q', route });
						expect(editor.source()).toBe(typed);
					});
});

/** A composition's place holds only where emptying the range keeps the block and shows no stray
 *  markers; the other rows keep the typing path's bytes, a known gap. */
const COMPOSED = new Set([
	'a heading’s whole text',
	'a range through a link’s close',
	'a word',
	'a paragraph’s whole text between blocks'
]);

// A pair of markers around nothing shows as its literal stars until the IME writes.
it('a composition over a finger’s range over a bold’s whole text shows no empty pair', async () => {
	const editor = mountCase('a **bold** c\n', 'live');
	await editor.settle();
	expect(await placeOwnedRange(editor, at([0], 4, 8))).toBe(true);
	const el = document.activeElement as HTMLElement;
	el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	await editor.settle();
	expect(editor.source()).not.toContain('****');
});

describe('a composition over a finger’s range inside one block lands where the key does', () => {
	for (const [name, source, range, modes, typed] of ROWS.filter(([n]) => COMPOSED.has(n)))
		for (const mode of modes)
			it(`${name}, ${mode}`, async () => {
				const editor = mountCase(source, mode);
				await editor.settle();
				expect(await placeOwnedRange(editor, range)).toBe(true);
				await typeGesture(editor, { text: 'Q', route: 'composition' });
				expect(editor.source()).toBe(typed);
			});
});

describe('a marker key over a finger’s range over a whole paragraph', () => {
	for (const [holder, place] of HOLDERS)
		it(`makes the kind and names it, ${holder}`, async () => {
			const editor = mountCase('para\n', 'live');
			await editor.settle();
			expect(await place(editor, at([0], 0, 4))).toBe(true);
			await typeGesture(editor, { text: '>', route: 'hardware key' });
			expect(editor.source()).toBe('>\n');
			expect(blockHostAt(editor, [0]).getAttribute('data-kind-cue')).toBe('Quote');
		});
});
