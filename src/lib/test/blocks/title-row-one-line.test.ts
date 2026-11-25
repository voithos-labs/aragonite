// @vitest-environment jsdom
// A title row holds one line on every write route: a line break is refused with no undo entry and
// no caret move, and text holding one goes in on the row's line (`plugin-contract.md` § Editable chrome).
// Miss-analysis: only the range core's paste flattened a title, and no row sent a break or a
// newline to a title row by a key, a soft keyboard, a composition, a drop or a block write.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	dispatchBeforeInput,
	dispatchPaste,
	dropAtCaret,
	insertBy,
	pressHardwareKey
} from '#lib/test/harness/insertion-routes.js';
import { mountCase, type Editor } from '#lib/test/range-laws/gestures.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { makeContainerHarness } from '#lib/test/harness/editor-actions.js';
import { makeSearchReplace, scanCompiled } from '#lib/test/harness/search-replace.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { serialize } from '#lib/core/serializer.js';
import { registeredAdmonitions } from '#lib/test/harness/registered-admonitions.js';
import { registeredDetails } from '#lib/test/harness/registered-details.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
});

const MODES: PresentationMode[] = ['live', 'source'];

/** Each row's document, the caret in its title (between `Tit` and `le`, `Sum` and `mary`), and the
 *  document with `a b` typed there. */
const ROWS = [
	{
		name: 'an opener row',
		source: ':::tip Title\nin\n:::\n',
		at: 10,
		spaced: ':::tip Tita ble\nin\n:::\n'
	},
	{
		name: 'a details summary',
		source: '<details open>\n<summary>Summary</summary>\n\nbody\n\n</details>\n',
		at: 3,
		spaced: '<details open>\n<summary>Suma bmary</summary>\n\nbody\n\n</details>\n'
	}
];

const focused = () => document.activeElement as HTMLElement;
const undoDepth = (editor: Editor) => editor.instance.__test.getUndoStack().undo.length;
const caret = (editor: Editor) => {
	const s = editor.instance.getSelection();
	return (
		s && {
			path: s.focus.path,
			offset: s.focus.offset,
			collapsed: s.anchor.offset === s.focus.offset
		}
	);
};

async function mountAt(source: string, mode: PresentationMode, at: number): Promise<Editor> {
	const editor = mountCase(source, mode);
	await editor.settle();
	placeCaret(surfaceAt(editor, [0, 0]), at);
	await editor.settle();
	return editor;
}

const BREAKS: [string, () => Promise<unknown>][] = [
	['Shift+Enter', () => pressHardwareKey(focused(), { key: 'Enter', shiftKey: true })],
	['a soft keyboard’s line break', async () => dispatchBeforeInput(focused(), 'insertLineBreak')]
];

describe.each(ROWS)('a line break in $name', ({ source, at }) => {
	for (const mode of MODES)
		for (const [gesture, act] of BREAKS)
			it(`${mode}: ${gesture} writes nothing, adds no undo entry and keeps the caret`, async () => {
				const editor = await mountAt(source, mode, at);
				const depth = undoDepth(editor);

				await act();
				await editor.settle();

				expect(editor.source()).toBe(source);
				expect(undoDepth(editor)).toBe(depth);
				expect(caret(editor)).toEqual({ path: [0, 0], offset: at, collapsed: true });
			});
});

// At the row's end a break elsewhere waits for the next letter, so the letter shows whether one opened.
const END_BREAKS: [string, () => Promise<unknown>][] = [
	...BREAKS,
	[
		'an IME commit ending in a backslash and a break',
		() => insertBy('composition', focused(), 'a\\\n')
	]
];

describe.each([
	['a titled row', ':::tip Title\nin\n:::\n', 12, ':::tip Title', '\nin\n:::\n'],
	['an untitled row', ':::tip\nin\n:::\n', 6, ':::tip ', '\nin\n:::\n']
])('at %s’s end', (_, source, at, head, tail) => {
	for (const mode of MODES)
		for (const [gesture, act] of END_BREAKS)
			it(`${mode}: ${gesture} then a letter writes the letter on the row`, async () => {
				const editor = await mountAt(source, mode, at);
				await act();
				await editor.settle();
				await insertBy('hardware key', focused(), 'x');
				await editor.settle();
				const composed = gesture.startsWith('an IME') ? 'a\\' : '';
				expect(editor.source()).toBe(head + composed + 'x' + tail);
			});
});

const TEXT_ROUTES: [string, (el: HTMLElement, text: string) => Promise<unknown>][] = [
	['an IME commit', (el, text) => insertBy('composition', el, text)],
	['a drop', (el, text) => dropAtCaret(el, text)],
	['a paste', async (el, text) => dispatchPaste(el, text)],
	['a browser paste', (el, text) => insertBy('browser paste', el, text)]
];

describe.each(ROWS)('text holding a newline put in $name', ({ source, at, spaced }) => {
	for (const mode of MODES)
		for (const [gesture, act] of TEXT_ROUTES)
			it(`${mode}: ${gesture} goes in on the row’s line`, async () => {
				const editor = await mountAt(source, mode, at);

				await act(focused(), 'a\nb');
				await editor.settle();

				expect(editor.source()).toBe(spaced);
				expect(caret(editor)).toEqual({ path: [0, 0], offset: at + 3, collapsed: true });
			});
});

// Text from outside the editor is the user's: a backslash before a line break stays as text. Missed
// because the paste took the key's rule, which drops the editor's own hard break whole.
describe.each(ROWS)('text holding a backslash and a line break put in $name', ({ source, at }) => {
	for (const mode of MODES)
		for (const [gesture, act] of TEXT_ROUTES)
			it(`${mode}: ${gesture} keeps the backslash and spaces the break`, async () => {
				const editor = await mountAt(source, mode, at);

				await act(focused(), 'a\\\nb');
				await editor.settle();

				const kept = source.slice(0, -1).replace(/(Tit|Sum)/, '$1a\\ b');
				expect(editor.source()).toBe(kept + source.slice(-1));
				expect(caret(editor)).toEqual({ path: [0, 0], offset: at + 4, collapsed: true });
			});
});

describe('a block write to a title row', () => {
	beforeEach(() => installPlugins([registeredAdmonitions(), registeredDetails()]));

	it('replaceRaw holding a newline writes one line', async () => {
		const h = makeContainerHarness(':::tip Title\nin\n:::\n', [0]);
		expect(await h.bundle.blockEdit.replaceRaw(0, ':::tip Ti\ntle\n')).toBe(true);
		expect(serialize(h.deps.doc)).toBe(':::tip Ti tle\nin\n:::\n');
	});

	// Only the editor's own break key is refused; a block write is text, its backslash kept.
	it('replaceRaw holding a backslash and a line break keeps the backslash', async () => {
		const h = makeContainerHarness(':::tip Title\nin\n:::\n', [0]);
		expect(await h.bundle.blockEdit.replaceRaw(0, ':::tip Tit\\\nle\n')).toBe(true);
		expect(serialize(h.deps.doc)).toBe(':::tip Tit\\ le\nin\n:::\n');
	});

	it('a regex replace writing a backslash and a line break keeps the backslash', async () => {
		const { deps, sr } = makeSearchReplace(':::tip Title\nin\n:::\n');
		await sr.replaceAll(
			scanCompiled(deps.doc, 'Title', { regex: true, caseSensitive: true }),
			'Ti\\\\\\ntle'
		);
		expect(serialize(deps.doc)).toBe(':::tip Ti\\ tle\nin\n:::\n');
	});

	// The row ends as it ended, so its own text without its line ending is its bytes already.
	it('replaceRaw of the row’s text without its line ending writes nothing', async () => {
		const h = makeContainerHarness(':::tip Title\nin\n:::\n', [0]);
		expect(await h.bundle.blockEdit.replaceRaw(0, ':::tip Title')).toBe(false);
		expect(serialize(h.deps.doc)).toBe(':::tip Title\nin\n:::\n');
		expect(h.deps.undoManager.getStacks().undo.length).toBe(0);
	});

	it.each([
		['an opener row', ':::tip Title\nin\n:::\n', 'Title', ':::tip Ti tle\nin\n:::\n'],
		[
			'a details summary',
			'<details>\n<summary>Title</summary>\n\nbody\n\n</details>\n',
			'Title',
			'<details>\n<summary>Ti tle</summary>\n\nbody\n\n</details>\n'
		]
	])('a regex replace writing a newline into %s writes one line', async (_, source, q, out) => {
		const { deps, sr } = makeSearchReplace(source);
		await sr.replaceAll(
			scanCompiled(deps.doc, q, { regex: true, caseSensitive: true }),
			'Ti\\ntle'
		);
		expect(serialize(deps.doc)).toBe(out);
	});
});
