import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { nativeSelectionText, pastLineEnd } from './multi-click-helpers';
import { multiClick, multiClickDrag } from '../../multi-click';
import { textRunCenter } from '../../text-runs';
import { WORD_MODIFIER } from '../../platform-keys';
import { nextRow } from '../presentation/helpers';
import { waitForImagesDecoded } from '../blocks/image/helpers';

// The word level of the click order (`requirements/selection/multi-click-word.md`), driven with
// real double-clicks on the plugins page so a rendered formula stands beside the word.

const PICTURE = '![x](/test-fixtures/sample.png)';

interface WordRow {
	name: string;
	mode: 'source' | 'live';
	doc: string;
	needle: string;
	/** The raw span the double-click selects in block `path`. */
	span: [number, number];
	path?: number[];
	/** The plugins page seed, when the row needs a plugin the math seed leaves out. */
	seed?: string;
	/** Whether to check Ctrl+Shift+Left too: the word jump is still the browser's, and only the
	 *  hidden-marker shapes agree on every engine. */
	jump?: boolean;
}

function besideWidgets(mode: WordRow['mode']): WordRow[] {
	const tail = (widget: string) => [4 + widget.length, 8 + widget.length] as [number, number];
	return [
		['an entity', '&copy;'],
		['a formula', '$x^2$'],
		['a picture', PICTURE]
	].flatMap(([what, widget]) => [
		{
			name: `${mode}: the word before ${what}`,
			mode,
			doc: `word${widget}tail\n`,
			needle: 'word',
			span: [0, 4]
		},
		{
			name: `${mode}: the word after ${what}`,
			mode,
			doc: `word${widget}tail\n`,
			needle: 'tail',
			span: tail(widget)
		}
	]);
}

const ROWS: WordRow[] = [
	{
		name: 'live: letters touching hidden markers are one word',
		mode: 'live',
		doc: 'a**b**c\n',
		needle: 'b',
		span: [0, 7],
		jump: true
	},
	{
		name: 'live: a word split by bold, between spaces',
		mode: 'live',
		doc: 'q a**b**c z\n',
		needle: 'b',
		span: [2, 9],
		jump: true
	},
	{
		name: 'live: hidden markers around a word stay outside it',
		mode: 'live',
		doc: 'some _ital_ words\n',
		needle: 'ital',
		span: [6, 10],
		jump: true
	},
	{
		name: 'live: a word in a list item',
		mode: 'live',
		doc: '- a**b**c\n',
		needle: 'b',
		span: [0, 7],
		path: [0, 0, 0]
	},
	{
		name: 'live: a word after the label a footnote definition draws in its line',
		mode: 'live',
		doc: '[^n]: a**b**c\n',
		needle: 'b',
		span: [0, 7],
		path: [0, 0],
		seed: 'footnotes'
	},
	{
		name: 'live: a word behind a hidden heading marker',
		mode: 'live',
		doc: '# a**b**c\n',
		needle: 'b',
		span: [2, 9]
	},
	{
		name: 'source: shown underscores belong to the word',
		mode: 'source',
		doc: 'some _ital_ words\n',
		needle: 'ital',
		span: [5, 11]
	},
	{
		name: 'source: a snake_case identifier is one word',
		mode: 'source',
		doc: 'call snake_case now\n',
		needle: 'case',
		span: [5, 15]
	},
	{
		name: 'source: a full stop between letters ends a word on every engine',
		mode: 'source',
		doc: 'call foo.bar now\n',
		needle: 'bar',
		span: [9, 12]
	},
	{
		name: 'source: shown asterisks split words',
		mode: 'source',
		doc: 'a**b**c\n',
		needle: 'b',
		span: [3, 4]
	},
	{
		name: 'source: no trailing space before an entity',
		mode: 'source',
		doc: 'a word &copy; after\n',
		needle: 'word',
		span: [2, 6]
	},
	...besideWidgets('live'),
	...besideWidgets('source')
];

test.describe('multi-click: the word inline syntax handler', () => {
	let editor: PluginsPage;

	/** Opens the plugins page on `seed` before each test of the describe it's called in. */
	function onSeed(seed: string): void {
		test.beforeEach(async ({ page }) => {
			editor = new PluginsPage(page);
			await editor.gotoPlugins(seed);
		});
	}

	async function doubleClickOn(needle: string): Promise<void> {
		await multiClick(editor.page, await textRunCenter(editor.page, needle), 2);
	}

	/** The single-block range the editor holds: its block and its raw span, start first. */
	function heldSpan(): Promise<{ path: number[]; span: [number, number] } | null> {
		return editor.page.evaluate(() => {
			const sel = (window as any).__test.getSelectionPaths();
			if (!sel) return null;
			const { anchor, focus } = sel;
			const span: [number, number] = [
				Math.min(anchor.offset, focus.offset),
				Math.max(anchor.offset, focus.offset)
			];
			return { path: focus.path, span };
		});
	}

	/** Loads `row.doc`, puts the caret at the word's end and presses `chord`, then Backspace if
	 *  the chord only selected; answers the document left. */
	async function afterChordAtWordEnd(row: WordRow, chord: string, thenBackspace: boolean) {
		await nextRow(editor, row.doc);
		await editor.focusBlockAtPath(row.path ?? [0], row.span[1]);
		await editor.page.keyboard.press(chord);
		if (thenBackspace) await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((source) => source !== row.doc);
		return editor.bridge.getSource();
	}

	function wordRowTest(row: WordRow): void {
		test(`${row.name}, and the word delete takes the same word`, async ({ page }) => {
			await editor.setPresentationMode(row.mode);
			await nextRow(editor, row.doc);
			// A picture decoding late moves the words after it under the press.
			if (row.doc.includes(PICTURE))
				await waitForImagesDecoded(page.locator('[data-inline-widget] img'));
			await doubleClickOn(row.needle);
			await expect.poll(heldSpan).toEqual({ path: row.path ?? [0], span: row.span });

			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSource((source) => source !== row.doc);
			const deleted = await editor.bridge.getSource();
			expect(await afterChordAtWordEnd(row, `${WORD_MODIFIER}+Backspace`, false)).toBe(deleted);
			if (row.jump) {
				expect(await afterChordAtWordEnd(row, `${WORD_MODIFIER}+Shift+ArrowLeft`, true)).toBe(
					deleted
				);
			}
		});
	}

	test.describe('on the footnotes page', () => {
		onSeed('footnotes');
		for (const row of ROWS.filter((row) => row.seed === 'footnotes')) wordRowTest(row);
	});

	test.describe('on the math page', () => {
		onSeed('math');
		for (const row of ROWS.filter((row) => row.seed === undefined)) wordRowTest(row);

		test('live: a drag from a double-click grows by the same words', async ({ page }) => {
			await editor.setPresentationMode('live');
			await nextRow(editor, 'a**b**c d**e**f\n');
			await multiClickDrag(page, await textRunCenter(page, 'b'), await textRunCenter(page, 'e'), 2);
			await expect.poll(heldSpan).toEqual({ path: [0], span: [0, 15] });
		});

		test('source: a word in a table cell, a code block and past a line end', async ({ page }) => {
			await editor.setPresentationMode('source');
			for (const [doc, needle] of [
				['| a | b |\n| --- | --- |\n| one two | c |\n', 'two'],
				['```\nconst value = 1\n```\n', 'value']
			]) {
				await nextRow(editor, doc);
				await doubleClickOn(needle);
				await expect.poll(() => nativeSelectionText(page)).toBe(needle);
			}

			await nextRow(editor, 'alpha beta gamma\n');
			await multiClick(page, await pastLineEnd(page, 'gamma'), 2);
			await expect.poll(() => nativeSelectionText(page)).toBe('gamma');
		});

		test('typing over the word replaces it and nothing else', async ({ page }) => {
			await editor.loadContent('alpha beta gamma\n');
			await doubleClickOn('beta');
			await expect.poll(() => nativeSelectionText(page)).toBe('beta');
			await page.keyboard.type('X');
			await editor.bridge.waitForSourceEquals('alpha X gamma\n');
		});
	});
});
