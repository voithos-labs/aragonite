import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import { addReplaceIsland } from '../../decoration-sources';
import { waitForFirstImageLoaded, waitForImagesDecoded } from '../blocks/image/helpers';
import { edgeKey, extendKey, isMacOS, WORD_MODIFIER } from '../../platform-keys';
import { textRunEnd } from '../../text-runs';
import { clickEnd, clickWordSettled } from '../presentation/helpers';

/**
 * A caret key lands where the editor decides, the same on every engine: a word or a line edge
 * where the matching delete ends, so Shift plus the key selects what that delete takes
 * (`requirements/caret/motion-class.md`). Rows on macOS press the Mac chords (Option, Cmd+Arrow).
 */

const PIC = '![x](/test-fixtures/sample.png)';
const WIDE_PIC = '![x|300x40](/test-fixtures/sample.png)';
const NARROW = '.editor { width: 420px !important; max-width: 420px !important; }';

type Gesture = 'wordBack' | 'wordForth' | 'lineStart' | 'lineEnd' | 'blockStart' | 'blockEnd';

interface Row {
	name: string;
	source: string;
	mode?: 'source' | 'live';
	/** The plugins page seed, for a row that needs a plugin's widget. */
	seed?: string;
	narrow?: boolean;
	decorate?: (page: Page) => Promise<void>;
	path?: number[];
	at: number;
	gesture: Gesture;
	/** The caret's raw offset after each press; `mac` where a Mac's forward word stops earlier. */
	lands: number[];
	mac?: number[];
	/** Whether the Shift twin's selection is checked against the matching delete. A start beside a
	 *  picture skips it: a delete there selects the picture, as the plain key does. */
	parity?: boolean;
}

const CHORD: Record<Gesture, string> = {
	wordBack: `${WORD_MODIFIER}+ArrowLeft`,
	wordForth: `${WORD_MODIFIER}+ArrowRight`,
	lineStart: edgeKey('lineStart'),
	lineEnd: edgeKey('lineEnd'),
	blockStart: edgeKey('blockStart'),
	blockEnd: edgeKey('blockEnd')
};

const SHIFT_CHORD: Partial<Record<Gesture, string>> = {
	wordBack: `Shift+${WORD_MODIFIER}+ArrowLeft`,
	wordForth: `Shift+${WORD_MODIFIER}+ArrowRight`,
	lineStart: extendKey('lineStart'),
	lineEnd: extendKey('lineEnd')
};

const ROWS: Row[] = [
	// Words.
	{
		name: 'source: back over a bold run',
		source: 'alpha **beta** gamma\n',
		at: 20,
		gesture: 'wordBack',
		lands: [15, 12, 8],
		parity: true
	},
	{
		name: 'source: forward over a bold run',
		source: 'alpha **beta** gamma\n',
		at: 0,
		gesture: 'wordForth',
		lands: [6, 8, 12],
		mac: [5, 8, 12],
		parity: true
	},
	{
		name: 'live: back over a hidden bold run',
		source: 'alpha **beta** gamma\n',
		mode: 'live',
		at: 20,
		gesture: 'wordBack',
		lands: [15, 8, 0],
		parity: true
	},
	{
		name: 'punctuation, forward',
		source: 'foo.bar, baz-qux end\n',
		at: 0,
		gesture: 'wordForth',
		lands: [3, 4, 7, 9, 12, 13],
		mac: [3, 4, 7, 8, 12, 13],
		parity: true
	},
	{
		name: 'punctuation, back',
		source: 'foo.bar, baz-qux end\n',
		at: 20,
		gesture: 'wordBack',
		lands: [17, 13, 12, 9, 7, 4],
		parity: true
	},
	{
		name: 'an entity and a picture, back',
		source: `one &copy; two ${PIC} three\n`,
		at: 52,
		gesture: 'wordBack',
		lands: [47, 15, 11, 4, 0],
		parity: true
	},
	{
		name: 'an entity and a picture, forward',
		source: `one &copy; two ${PIC} three\n`,
		at: 0,
		gesture: 'wordForth',
		lands: [4, 11, 15, 47, 52],
		mac: [3, 10, 14, 46, 52]
	},
	{
		name: 'a word after an entity, back',
		source: 'word&copy;tail\n',
		at: 14,
		gesture: 'wordBack',
		lands: [10, 4],
		parity: true
	},
	{
		name: 'a word after a picture, back',
		source: `word${PIC}tail\n`,
		at: 39,
		gesture: 'wordBack',
		lands: [35, 4]
	},
	{
		name: 'a word before a picture, forward',
		source: `word${PIC}tail\n`,
		at: 0,
		gesture: 'wordForth',
		lands: [4, 35, 39]
	},
	{
		name: 'a word after a formula, back',
		source: 'word$x^2$tail\n',
		seed: 'math',
		at: 13,
		gesture: 'wordBack',
		lands: [9, 4]
	},
	{
		name: 'source: underscores on screen are the word’s',
		source: 'some _ital_ words\n',
		at: 11,
		gesture: 'wordBack',
		lands: [5],
		parity: true
	},
	{
		name: 'a picture inside a line, back',
		source: `abc ${PIC} def\n`,
		at: 39,
		gesture: 'wordBack',
		lands: [36, 4, 0],
		parity: true
	},
	{
		name: 'a picture inside a line, forward',
		source: `abc ${PIC} def\n`,
		at: 0,
		gesture: 'wordForth',
		lands: [4, 36, 39],
		mac: [3, 35, 39]
	},
	{
		name: 'a CRLF line ending, back',
		source: 'abc def\r\nghi\r\n',
		at: 12,
		gesture: 'wordBack',
		lands: [9, 7, 4, 0],
		parity: true
	},
	{
		name: 'a CRLF line ending, forward',
		source: 'abc def\r\nghi\r\n',
		at: 0,
		gesture: 'wordForth',
		lands: [4, 7, 9, 12],
		mac: [3, 7, 9, 12],
		parity: true
	},
	{
		name: 'a code body, back',
		source: '```\nfoo.bar baz\n```\n',
		at: 15,
		gesture: 'wordBack',
		lands: [12, 8, 7],
		parity: true
	},
	{
		name: 'a code body, forward',
		source: '```\nfoo.bar baz\n```\n',
		at: 4,
		gesture: 'wordForth',
		lands: [7, 8, 12],
		mac: [7, 8, 11],
		parity: true
	},
	{
		name: 'a table cell, back',
		source: '| a b.c | d |\n| - | - |\n',
		path: [0, 0, 0],
		at: 5,
		gesture: 'wordBack',
		lands: [4, 3, 2]
	},
	{
		name: 'a table cell, forward',
		source: '| a b.c | d |\n| - | - |\n',
		path: [0, 0, 0],
		at: 1,
		gesture: 'wordForth',
		lands: [2, 3, 4],
		mac: [3, 4, 5]
	},
	{
		name: 'a list item, back to its text’s start',
		source: '- abc def\n',
		path: [0, 0, 0],
		at: 7,
		gesture: 'wordBack',
		lands: [4, 0],
		parity: true
	},
	// Line and block edges.
	{
		name: 'the line end past a trailing picture',
		source: `lead ${PIC}\n`,
		at: 1,
		gesture: 'lineEnd',
		lands: [36],
		parity: true
	},
	{
		name: 'the block end past a trailing picture',
		source: `lead ${PIC}\n`,
		at: 1,
		gesture: 'blockEnd',
		lands: [36]
	},
	{
		name: 'the line start before a leading picture',
		source: `${PIC} lead\n`,
		at: 36,
		gesture: 'lineStart',
		lands: [0]
	},
	{
		name: 'the line end from before a leading picture',
		source: `${PIC} lead\n`,
		at: 0,
		gesture: 'lineEnd',
		lands: [36]
	},
	{
		name: 'the line start before a picture after a hard break',
		source: `first\\\n${PIC} second\n`,
		at: 45,
		gesture: 'lineStart',
		lands: [7]
	},
	{
		name: 'the line end past a trailing replace decoration',
		source: 'lead HIDDEN\n',
		decorate: (page) => addReplaceIsland(page, [0], 5, 11),
		at: 0,
		gesture: 'lineEnd',
		lands: [11],
		parity: true
	},
	{
		name: 'the line end before a trailing <br>',
		source: 'lead<br>\n',
		at: 0,
		gesture: 'lineEnd',
		lands: [4]
	},
	{
		name: 'the block end past a trailing <br>',
		source: 'lead<br>\n',
		at: 0,
		gesture: 'blockEnd',
		lands: [8]
	},
	{
		name: 'source: a list item’s line start is past its marker',
		source: '- abc def\n',
		path: [0, 0, 0],
		at: 4,
		gesture: 'lineStart',
		lands: [0],
		parity: true
	},
	{
		name: 'a list item’s line after a hard break starts at that line',
		source: '- abc\\\ndef\n',
		path: [0, 0, 0],
		at: 8,
		gesture: 'lineStart',
		lands: [5],
		parity: true
	},
	{
		name: 'live: a heading’s line start is past its hidden marker',
		source: '# Title here\n',
		mode: 'live',
		at: 12,
		gesture: 'lineStart',
		lands: [2]
	},
	{
		name: 'the line end before a CRLF pair',
		source: 'abc def\r\nghi\r\n',
		at: 0,
		gesture: 'lineEnd',
		lands: [7],
		parity: true
	},
	{
		name: 'the block end of plain text',
		source: 'alpha beta\n',
		at: 5,
		gesture: 'blockEnd',
		lands: [10]
	},
	{
		name: 'a picture opening a wrapped line: Home on line 1',
		source: `before\n\nalpha beta gamma ${WIDE_PIC} tail\n\nafter\n`,
		narrow: true,
		path: [1],
		at: 17,
		gesture: 'lineStart',
		lands: [0]
	},
	{
		name: 'a picture opening a wrapped line: End on line 1',
		source: `before\n\nalpha beta gamma ${WIDE_PIC} tail\n\nafter\n`,
		narrow: true,
		path: [1],
		at: 17,
		gesture: 'lineEnd',
		lands: [17]
	}
];

async function open(page: Page, row: Row): Promise<EditorPage> {
	const editor = row.seed ? new PluginsPage(page) : new EditorPage(page);
	if (row.seed) await (editor as PluginsPage).gotoPlugins(row.seed);
	else await editor.goto(row.mode === 'live' ? '?presentationMode=live' : '');
	if (row.narrow) await page.addStyleTag({ content: NARROW });
	await editor.loadContent(row.source);
	if (row.decorate) {
		await row.decorate(page);
		await expect(page.locator('[data-decoration-island]')).toHaveCount(1);
	}
	if (row.source.includes('![')) await waitForImagesDecoded(page.locator('.editor img'));
	await editor.focusBlockAtPath(row.path ?? [0], row.at);
	return editor;
}

const lands = (row: Row) => (isMacOS && row.mac ? row.mac : row.lands);

async function selection(editor: EditorPage) {
	await editor.waitForRenderFlush();
	return editor.bridge.getSelectionPaths();
}

/** A keyless delete of `gesture`'s unit, as a Mac's Cmd+Backspace sends it on every engine. */
async function deleteBy(page: Page, gesture: Gesture): Promise<void> {
	if (gesture === 'wordBack' || gesture === 'wordForth') {
		await page.keyboard.press(
			`${WORD_MODIFIER}+${gesture === 'wordBack' ? 'Backspace' : 'Delete'}`
		);
		return;
	}
	const inputType = gesture === 'lineStart' ? 'deleteSoftLineBackward' : 'deleteSoftLineForward';
	await page.evaluate((inputType) => {
		document.activeElement!.dispatchEvent(
			new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
		);
	}, inputType);
}

test.describe('a caret key lands where the editor decides', () => {
	for (const row of ROWS) {
		test(row.name, async ({ page }) => {
			const editor = await open(page, row);
			const path = row.path ?? [0];
			for (const offset of lands(row)) {
				await page.keyboard.press(CHORD[row.gesture]);
				expect((await selection(editor))?.focus).toEqual({ path, offset });
			}
		});

		const shifted = SHIFT_CHORD[row.gesture];
		if (!shifted || !row.parity) continue;
		test(`${row.name}, with Shift: selects what the delete takes`, async ({ page }) => {
			let editor = await open(page, row);
			const path = row.path ?? [0];
			for (const offset of lands(row)) {
				await page.keyboard.press(shifted);
				expect(await selection(editor)).toEqual({
					anchor: { path, offset: row.at },
					focus: { path, offset }
				});
			}
			await page.keyboard.press('Backspace');
			await editor.waitForRenderFlush();
			const selected = await editor.bridge.getSource();
			editor = await open(page, row);
			for (let i = 0; i < lands(row).length; i++) await deleteBy(page, row.gesture);
			await expect.poll(() => editor.bridge.getSource()).toBe(selected);
		});
	}
});

test.describe('a key over a range in one block moves from its edge on the key’s side', () => {
	const source = 'alpha beta gamma delta\n';
	for (const [hold, key, landing] of [
		['Shift+ArrowRight', `${WORD_MODIFIER}+ArrowLeft`, 6],
		['Shift+ArrowLeft', `${WORD_MODIFIER}+ArrowRight`, isMacOS ? 10 : 11]
	] as const) {
		test(`${hold} twice, then ${key}`, async ({ page }) => {
			const editor = await open(page, { name: '', source, at: 8, gesture: 'wordBack', lands: [] });
			await page.keyboard.press(hold);
			await page.keyboard.press(hold);
			await page.keyboard.press(key);
			expect((await selection(editor))?.focus).toEqual({ path: [0], offset: landing });
		});
	}
});

test.describe('a picture opening a wrapped line', () => {
	test('Home on line 2 lands before the picture, where a typed letter goes', async ({ page }) => {
		const source = `before\n\nalpha beta gamma ${WIDE_PIC} tail\n\nafter\n`;
		const row: Row = {
			name: '',
			source,
			narrow: true,
			path: [1],
			at: 60,
			gesture: 'lineStart',
			lands: []
		};
		const editor = await open(page, row);
		await page.keyboard.press(CHORD.lineStart);
		expect((await selection(editor))?.focus).toEqual({ path: [1], offset: 17 });
		await page.keyboard.press('Z');
		await expect
			.poll(() => editor.bridge.getSource())
			.toBe(`before\n\nalpha beta gamma Z${WIDE_PIC} tail\n\nafter\n`);
	});
});

// ── Spans a plain arrow crosses whole ───────────────────────────────────────

interface SpanCase {
	name: string;
	open(page: Page): Promise<EditorPage>;
	/** The block the caret is placed in; a table takes its first cell. */
	path: number[];
	start: number;
	end: number;
}

async function editorWith(page: Page, source: string): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(source);
	return editor;
}

const CASES: SpanCase[] = [
	{
		name: 'a decoded entity',
		open: (page) => editorWith(page, 'a&copy;b\n'),
		path: [0],
		start: 1,
		end: 7
	},
	{
		name: 'a plugin emoji',
		open: async (page) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('emoji');
			return editor;
		},
		// `Mood :smile: today`
		path: [0],
		start: 5,
		end: 12
	},
	{
		name: 'a replace decoration',
		open: async (page) => {
			const editor = await editorWith(page, 'abHIDDENcd\n');
			await addReplaceIsland(page, [0], 2, 8);
			await expect(page.locator('[data-decoration-island]')).toHaveCount(1);
			return editor;
		},
		path: [0],
		start: 2,
		end: 8
	},
	{
		name: 'an entity in a table cell',
		open: (page) => editorWith(page, '| a&copy;b |\n| --- |\n'),
		path: [0],
		start: 1,
		end: 7
	},
	{
		name: 'a CRLF pair in a paragraph',
		open: (page) => editorWith(page, 'abc\r\nAfter\r\n'),
		path: [0],
		start: 3,
		end: 5
	},
	{
		name: 'a CRLF pair in a code body',
		open: (page) => editorWith(page, '```\r\nabc\r\nxyz\r\n```\r\n'),
		path: [0],
		start: 8,
		end: 10
	}
];

for (const span of CASES) {
	test.describe(`one press crosses ${span.name}`, () => {
		let editor: EditorPage;
		let source: string;

		/** Anchor and focus offsets, after checking both sit in the block the case started in. */
		async function ends(): Promise<[number, number]> {
			const paths = await editor.bridge.getSelectionPaths();
			expect(paths?.anchor.path).toEqual(paths?.focus.path);
			return [paths!.anchor.offset, paths!.focus.offset];
		}

		test.beforeEach(async ({ page }) => {
			editor = await span.open(page);
			source = await editor.bridge.getSource();
			await editor.focusBlockAtPath(span.path, span.start);
			expect(await ends()).toEqual([span.start, span.start]);
		});

		test.afterEach(async () => {
			expect(await editor.bridge.getSource()).toBe(source);
		});

		test('ArrowRight lands at the far edge, ArrowLeft back, and the next step is one character', async ({
			page
		}) => {
			await page.keyboard.press('ArrowRight');
			expect(await ends()).toEqual([span.end, span.end]);
			await page.keyboard.press('ArrowLeft');
			expect(await ends()).toEqual([span.start, span.start]);
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('ArrowRight');
			expect(await ends()).toEqual([span.end + 1, span.end + 1]);
		});

		test('Shift+ArrowRight extends across it and Shift+ArrowLeft takes it back', async ({
			page
		}) => {
			await page.keyboard.press('Shift+ArrowRight');
			expect(await ends()).toEqual([span.start, span.end]);
			await page.keyboard.press('Shift+ArrowLeft');
			expect(await ends()).toEqual([span.start, span.start]);
		});

		test('Shift+ArrowLeft from the far edge extends back across it', async ({ page }) => {
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('Shift+ArrowLeft');
			expect(await ends()).toEqual([span.end, span.start]);
		});
	});
}

// Option+Arrow is a Mac's word key in every block, so the cell's column chords never take it there.
// Off a Mac, the page reads a Mac platform and the keys are pressed with Alt.
test.describe('on a Mac, Option+Arrow in a table cell moves by word, not the column', () => {
	const source = '| a b.c | d |\n| - | - |\n';
	for (const [key, at, focus] of [
		['Alt+ArrowRight', 1, 3],
		['Alt+ArrowLeft', 5, 4],
		['Alt+Shift+ArrowRight', 1, 3]
	] as const) {
		test(`${key} from ${at}`, async ({ page }) => {
			await page.addInitScript(() =>
				Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' })
			);
			const editor = await open(page, {
				name: '',
				source,
				path: [0, 0, 0],
				at,
				gesture: 'wordBack',
				lands: []
			});
			await page.keyboard.press(key);
			expect((await selection(editor))?.focus).toEqual({ path: [0, 0, 0], offset: focus });
			expect(await editor.bridge.getSource()).toBe(source);
		});
	}

	// The host's own keymap beats the editor's, as a rebound Backspace does.
	test('a host binding Option+Right to the column move still moves the column', async ({
		page
	}) => {
		await page.addInitScript(() =>
			Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' })
		);
		const editor = await open(page, {
			name: '',
			source,
			path: [0, 0, 0],
			at: 1,
			gesture: 'wordBack',
			lands: []
		});
		await page.evaluate(() =>
			(window as any).__test.setKeybindings([
				{ kind: 'tableCell', chord: 'Alt+ArrowRight', command: 'table.moveColumnRight' }
			])
		);
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await page.keyboard.press('Alt+ArrowRight');
		await expect.poll(() => editor.bridge.getSource()).toBe('| d | a b.c |\n| - | - |\n');
	});
});

// A key that moves nothing fires no `selectionchange`, so its record is still open when a click
// moves the caret, and the fixture's console check fails on a G1.163 fire.
test('a caret key that moves nothing, then a click, is no browser move', async ({ page }) => {
	const editor = await editorWith(page, 'alpha beta\n\nsecond block\n');
	for (const [key, at] of [
		[edgeKey('lineStart'), 0],
		[edgeKey('lineEnd'), 10],
		[edgeKey('blockStart'), 0]
	] as const) {
		await editor.focusBlockAtPath([0], at);
		await page.keyboard.press(key);
		await clickWordSettled(editor, page, 'second');
		await expect
			.poll(async () => (await editor.bridge.getSelectionPaths())?.focus.path)
			.toEqual([1]);
	}
});

test.describe('one press crosses a CRLF pair from a caret the browser parked', () => {
	test('End, then Shift+ArrowRight, selects the pair from the line end', async ({ page }) => {
		const editor = await editorWith(page, 'abc\r\nAfter\r\n');
		await editor.focusBlockAtPath([0], 0);
		// WebKit and Firefox park the caret between the `\r` and the `\n` here.
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('Shift+ArrowRight');
		const paths = await editor.bridge.getSelectionPaths();
		expect([paths?.anchor.offset, paths?.focus.offset]).toEqual([3, 5]);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('ArrowRight');
		expect((await editor.bridge.getSelectionPaths())?.focus.offset).toBe(5);
	});
});

// ── Both spellings of an edge key ───────────────────────────────────────────

interface EdgeRow {
	name: string;
	doc: string;
	live?: boolean;
	place: (ep: EditorPage, page: Page) => Promise<void>;
	/** The Windows and Linux spelling, and macOS's. */
	chords: { key: string; arrow: string };
	/** Whether the browser moves the caret for `key` itself, which macOS, scrolling, does not. */
	nativeKey?: boolean;
	/** The source once a `Z` is typed after the chord, or where the caret stands after it. */
	outcome: { typed: string } | { caret: { path: number[]; offset: number } };
}

/** A click on `word` once the image beside it has loaded, so the line's layout is final. */
function besideImage(word: string): EdgeRow['place'] {
	return async (ep, page) => {
		await waitForFirstImageLoaded(page);
		await clickWordSettled(ep, page, word);
	};
}

/** A click on the image, so it sits selected with its toolbar up. */
const selectImage: EdgeRow['place'] = async (ep, page) => {
	await waitForFirstImageLoaded(page);
	await page.locator('[data-image-widget]').first().click();
	await expect(page.locator('[data-image-overlay]')).toBeVisible();
};

// Mid-line and between blocks, so a key that leaves from the wrong edge, or that extends past the
// image or short of it, types somewhere else.
const SELECTED = `one\n\nbefore ${PIC} after\n\ntwo\n`;

const SELECTED_ROWS: EdgeRow[] = [
	{
		name: 'the block start from a selected image leaves the image',
		doc: SELECTED,
		place: selectImage,
		chords: { key: 'ControlOrMeta+Home', arrow: 'Meta+ArrowUp' },
		nativeKey: true,
		outcome: { typed: `one\n\nZbefore ${PIC} after\n\ntwo\n` }
	},
	{
		name: 'the block end from a selected image leaves the image',
		doc: SELECTED,
		place: selectImage,
		chords: { key: 'ControlOrMeta+End', arrow: 'Meta+ArrowDown' },
		nativeKey: true,
		outcome: { typed: `one\n\nbefore ${PIC} afterZ\n\ntwo\n` }
	},
	{
		name: 'extending to the line start from a selected image keeps the image',
		doc: SELECTED,
		place: selectImage,
		chords: { key: 'Shift+Home', arrow: 'Shift+Meta+ArrowLeft' },
		nativeKey: true,
		outcome: { typed: 'one\n\nZ after\n\ntwo\n' }
	},
	{
		name: 'extending to the line end from a selected image keeps the image',
		doc: SELECTED,
		place: selectImage,
		chords: { key: 'Shift+End', arrow: 'Shift+Meta+ArrowRight' },
		nativeKey: true,
		outcome: { typed: 'one\n\nbefore Z\n\ntwo\n' }
	},
	{
		name: "extending to the document's start from a selected image keeps the image",
		doc: SELECTED,
		place: selectImage,
		chords: { key: 'ControlOrMeta+Shift+Home', arrow: 'Shift+Meta+ArrowUp' },
		outcome: { typed: 'Z after\n\ntwo\n' }
	},
	{
		name: "extending to the document's end from a selected image keeps the image",
		doc: SELECTED,
		place: selectImage,
		chords: { key: 'ControlOrMeta+Shift+End', arrow: 'Shift+Meta+ArrowDown' },
		outcome: { typed: 'one\n\nbefore Z\n' }
	}
];

const EDGE_ROWS: EdgeRow[] = [
	{
		name: 'the line start before a leading image types ahead of it',
		doc: `${PIC} tail\n`,
		place: besideImage('tail'),
		chords: { key: 'Home', arrow: 'Meta+ArrowLeft' },
		outcome: { typed: `Z${PIC} tail\n` }
	},
	{
		name: 'extending to the line start before a leading image takes the image',
		doc: `${PIC} tail\n`,
		place: async (ep, page) => {
			await waitForFirstImageLoaded(page);
			await clickEnd(ep, page, 'tail');
		},
		chords: { key: 'Shift+Home', arrow: 'Shift+Meta+ArrowLeft' },
		outcome: { typed: 'Z\n' }
	},
	{
		name: 'the block start before a leading image types ahead of it',
		doc: `${PIC} tail\n`,
		place: besideImage('tail'),
		chords: { key: 'ControlOrMeta+Home', arrow: 'Meta+ArrowUp' },
		outcome: { typed: `Z${PIC} tail\n` }
	},
	{
		name: 'the block end lands past a trailing image',
		doc: `text ${PIC}\n`,
		place: besideImage('text'),
		chords: { key: 'ControlOrMeta+End', arrow: 'Meta+ArrowDown' },
		outcome: { caret: { path: [0], offset: `text ${PIC}`.length } }
	},
	{
		name: 'the line end past a code chip types outside it',
		doc: 'see `code`\n',
		live: true,
		place: async (ep, page) => {
			const point = await textRunEnd(page, 'see');
			await page.mouse.click(point.x - 4, point.y);
			await ep.waitForRenderFlush();
		},
		chords: { key: 'End', arrow: 'Meta+ArrowRight' },
		nativeKey: true,
		outcome: { typed: 'see `code`Z\n' }
	},
	{
		name: 'the line start from a selected image leaves the image',
		doc: `before ${PIC} after\n`,
		place: selectImage,
		chords: { key: 'Home', arrow: 'Meta+ArrowLeft' },
		nativeKey: true,
		outcome: { typed: `Zbefore ${PIC} after\n` }
	},
	...SELECTED_ROWS,
	{
		name: 'the line start on the line Shift+Enter opened keeps that line',
		doc: 'abc\n',
		place: async (ep, page) => {
			await clickEnd(ep, page, 'abc');
			await page.keyboard.press('Shift+Enter');
			await ep.waitForRenderFlush();
		},
		chords: { key: 'Home', arrow: 'Meta+ArrowLeft' },
		outcome: { typed: 'abc\\\nZ\n' }
	},
	{
		name: "extending to the document's end takes every block after the caret",
		doc: 'one\n\ntwo\n',
		place: (ep, page) => clickEnd(ep, page, 'one'),
		chords: { key: 'ControlOrMeta+Shift+End', arrow: 'Shift+Meta+ArrowDown' },
		outcome: { typed: 'oneZ\n' }
	}
];

async function openDoc(page: Page, doc: string, live = false): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto(live ? '?presentationMode=live' : '');
	await ep.loadContent(doc);
	return ep;
}

const focusOf = (ep: EditorPage) => ep.bridge.getSelectionPaths().then((sel) => sel?.focus);

test.describe('a caret-edge site reads both spellings of its key', () => {
	for (const row of EDGE_ROWS) {
		for (const spelling of ['key', 'arrow'] as const) {
			const chord = row.chords[spelling];
			test(`${chord}: ${row.name}`, async ({ page }) => {
				test.skip(
					isMacOS && spelling === 'key' && row.nativeKey === true,
					'macOS scrolls on Home and End, so the browser moves no caret for the key'
				);
				const ep = await openDoc(page, row.doc, row.live);
				await row.place(ep, page);
				await page.keyboard.press(chord);
				await ep.waitForRenderFlush();
				const { outcome } = row;
				if ('caret' in outcome) {
					await expect.poll(() => focusOf(ep)).toEqual(outcome.caret);
					return;
				}
				await page.keyboard.press('Z');
				await expect.poll(() => ep.bridge.getSource()).toBe(outcome.typed);
			});
		}
	}
});
