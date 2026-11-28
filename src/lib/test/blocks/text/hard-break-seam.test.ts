// @vitest-environment jsdom
// A hard break cuts where a paragraph break at the same caret cuts: past the closers of a run that
// ends there, in place of a soft line break right there, so the line after stays in the paragraph.
// Miss-analysis: every hard-break row broke mid-line, and none broke at a line's end where a soft
// line break follows, the one place the paragraph break consumes a byte.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey, dispatchBeforeInput } from '#lib/test/harness/insertion-routes.js';
import { mountCase, placeRange } from '#lib/test/range-laws/gestures.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const focused = () => document.activeElement as HTMLElement;
const caret = (path: number[], offset: number) => ({
	anchor: { path, offset },
	focus: { path, offset }
});

/** A source, the caret, the modes, and the bytes a hard break there leaves. */
const BR = '\\\n';
const LIVE: PresentationMode[] = ['live'];
const BOTH: PresentationMode[] = ['live', 'source'];
const ROWS: [string, string, ReturnType<typeof caret>, PresentationMode[], string][] = [
	['a line end before a soft break', 'one\ntwo\n', caret([0], 3), BOTH, `one${BR}two\n`],
	['the same in a quote', '> one\n> two\n', caret([0, 0], 3), BOTH, `> one${BR}> two\n`],
	['a run’s close, caret inside it', '*oneo*\ntwo\n', caret([0], 5), LIVE, `*oneo*${BR}two\n`],
	['a run’s close, caret past it', '*oneo*\ntwo\n', caret([0], 6), BOTH, `*oneo*${BR}two\n`],
	['a link’s close', '[oneo](u)\ntwo\n', caret([0], 5), LIVE, `[oneo](u)${BR}two\n`],
	['bold in an item', '- **oneo**\n  two\n', caret([0, 0, 0], 6), LIVE, `- **oneo**${BR}  two\n`],
	['a run’s close, text after', '*oneo* more\n', caret([0], 5), LIVE, `*oneo*${BR} more\n`],
	[
		'mid-run, which a hard break may span',
		'*oneo*\ntwo\n',
		caret([0], 3),
		LIVE,
		`*on${BR}eo*\ntwo\n`
	],
	['mid-line', 'one\ntwo\n', caret([0], 2), BOTH, `on${BR}e\ntwo\n`],
	['CRLF lines', 'one\r\ntwo\r\n', caret([0], 3), BOTH, 'one\\\r\ntwo\r\n'],
	[
		'a rest a to-do’s next line would read as a heading',
		'- [ ] **x**# y\n',
		caret([0, 0, 0], 3),
		LIVE,
		`- [ ] **x${BR}  **# y\n`
	]
];

const ROUTES = [
	['Shift+Enter', () => pressHardwareKey(focused(), { key: 'Enter', shiftKey: true })],
	['a soft keyboard’s line break', () => dispatchBeforeInput(focused(), 'insertLineBreak')]
] as const;

describe('a hard break cuts where a paragraph break cuts', () => {
	for (const [name, source, at, modes, broken] of ROWS)
		for (const mode of modes)
			for (const [route, press] of ROUTES)
				it(`${name}, ${route}, ${mode}`, async () => {
					const editor = mountCase(source, mode);
					await editor.settle();
					expect(await placeRange(editor, at)).toBe(true);
					await press();
					await editor.settle();
					expect(editor.source()).toBe(broken);
				});

	it('leaves the caret before the line it broke onto', async () => {
		const editor = mountCase('one\ntwo\n', 'source');
		await editor.settle();
		expect(await placeRange(editor, caret([0], 3))).toBe(true);
		await pressHardwareKey(focused(), { key: 'Enter', shiftKey: true });
		await editor.settle();
		expect(editor.instance.getSelection()).toEqual(caret([0], 5));
	});

	// Miss-analysis: the caret row broke at a line's end only, never past a closer with text after.
	it('leaves the caret before the text it broke onto, past a run’s close', async () => {
		const editor = mountCase('a **bold** c\n', 'live');
		await editor.settle();
		expect(await placeRange(editor, caret([0], 8))).toBe(true);
		await pressHardwareKey(focused(), { key: 'Enter', shiftKey: true });
		await editor.settle();
		expect(editor.source()).toBe(`a **bold**${BR} c\n`);
		expect(editor.instance.getSelection()).toEqual(caret([0], 12));
	});

	// Live puts the caret past the hidden break; source can hold it between `\` and the line ending.
	for (const mode of BOTH)
		it(`keeps a hard break the line already ends in, ${mode}`, async () => {
			const editor = mountCase(`one${BR}two\n`, mode);
			await editor.settle();
			expect(await placeRange(editor, caret([0], 4))).toBe(true);
			await pressHardwareKey(focused(), { key: 'Enter', shiftKey: true });
			await editor.settle();
			expect(editor.source()).toBe(`one${BR}${BR}two\n`);
			expect(editor.instance.getSelection()).toEqual(caret([0], 5));
		});

	// Miss-analysis: the kept-break rows ended the line in a backslash only, never in the two
	// trailing spaces that are the other hard break, nor in a space before the soft break.
	const SPACED: [string, string, number, PresentationMode[], string][] = [
		['two spaces, caret before them', 'one  \ntwo\n', 3, BOTH, `one  \n${BR}two\n`],
		['two spaces, caret past them', 'one  \ntwo\n', 5, ['source'], `one  \n${BR}two\n`],
		['a backslash, caret before it', `one${BR}two\n`, 3, BOTH, `one${BR}${BR}two\n`],
		['one space, caret before it', 'one \ntwo\n', 3, BOTH, `one ${BR}two\n`]
	];
	for (const [name, source, at, modes, broken] of SPACED)
		for (const mode of modes)
			it(`a line ending in ${name}, ${mode}`, async () => {
				const editor = mountCase(source, mode);
				await editor.settle();
				expect(await placeRange(editor, caret([0], at))).toBe(true);
				await pressHardwareKey(focused(), { key: 'Enter', shiftKey: true });
				await editor.settle();
				expect(editor.source()).toBe(broken);
				// On the line the break opened.
				expect(editor.instance.getSelection()).toEqual(caret([0], broken.indexOf('\n') + 1));
			});
});
