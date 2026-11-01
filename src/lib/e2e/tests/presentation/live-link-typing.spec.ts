import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { clickEnd, enterPresentationMode, keys, nextRow } from './helpers';
import { multiClick } from '../../multi-click';
import { textRunCenter } from '../../text-runs';

// Typing into and over a link's text in live mode, the way Google Docs does it.
// Requirements: e2e/requirements/presentation/live-link-typing.md.

const U = 'https://e.example';
const LINK = `[example](${U})`;

/** The same link at each place a block can hold it, as a document and the bytes `t` makes of it. */
const PLACES: { name: string; doc: (t: string) => string }[] = [
	{ name: 'mid-paragraph', doc: (t) => `Visit ${t} now` },
	{ name: 'a paragraph’s start', doc: (t) => `${t} now` },
	{ name: 'a heading’s start', doc: (t) => `# ${t} now` },
	{ name: 'a table cell’s start', doc: (t) => `| a | b |\n| - | - |\n| ${t} | z |` }
];

/** From the end of `example`: `back` plain steps left, then `grow` shift steps left. */
async function selectIn(ep: EditorPage, page: Page, back: number, grow: number): Promise<void> {
	await clickEnd(ep, page, 'example');
	await keys(ep, page, ...Array(back).fill('ArrowLeft'), ...Array(grow).fill('Shift+ArrowLeft'));
}

async function typeIn(ep: EditorPage, page: Page, text: string): Promise<void> {
	await page.keyboard.type(text);
	await ep.waitForRenderFlush();
}

const GESTURES: { name: string; back: number; grow: number; written: string }[] = [
	{
		name: 'a caret inside the text stays linked, space included',
		back: 3,
		grow: 0,
		written: `[exama bple](${U})`
	},
	{
		name: 'a selection touching neither end stays linked',
		back: 1,
		grow: 3,
		written: `[exaa be](${U})`
	},
	{
		name: 'a selection touching the start goes outside, the rest stays linked',
		back: 4,
		grow: 3,
		written: `a b[mple](${U})`
	},
	{
		name: 'a selection touching the end goes outside, the rest stays linked',
		back: 0,
		grow: 3,
		written: `[exam](${U})a b`
	},
	{ name: 'the whole text typed over removes the link', back: 0, grow: 7, written: 'a b' },
	{ name: 'a caret at the end never extends the link', back: 0, grow: 0, written: `${LINK}a b` }
];

test.describe('live mode: typing into and over a link’s text', () => {
	for (const gesture of GESTURES) {
		test(`${gesture.name}, at every place a link can stand`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'live', PLACES[0].doc(LINK));
			for (const place of PLACES) {
				await nextRow(ep, place.doc(LINK));
				await selectIn(ep, page, gesture.back, gesture.grow);
				await typeIn(ep, page, 'a b');
				expect(await ep.bridge.getSource(), place.name).toBe(place.doc(gesture.written));
			}
		});
	}

	test('typing over part of the text then undoing restores the link in one step', async ({
		page
	}) => {
		const doc = PLACES[0].doc(LINK);
		const ep = await enterPresentationMode(page, 'live', doc);
		await selectIn(ep, page, 4, 3);
		await typeIn(ep, page, 'a b');
		await ep.endTypingBatch();
		await ep.undo();
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getSource()).toBe(doc);
	});
});

test.describe('live mode: a selection reaching past the link’s edge', () => {
	const DOC = `Visit ${LINK} now`;

	/** From the end of `now`'s `no`: the selection grows left over `ple no`, into the link. */
	async function fromAfter(ep: EditorPage, page: Page): Promise<void> {
		await clickEnd(ep, page, 'now');
		await keys(ep, page, 'ArrowLeft', ...Array(6).fill('Shift+ArrowLeft'));
	}

	/** From the link's `exa`: the selection grows left over `sit exa`, out of the link. */
	async function fromInside(ep: EditorPage, page: Page): Promise<void> {
		await selectIn(ep, page, 4, 7);
	}

	test('typed over from inside the link to past it, the text before stays linked', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await fromAfter(ep, page);
		await typeIn(ep, page, 'X');
		expect(await ep.bridge.getSource()).toBe(`Visit [exam](${U})Xw`);
	});

	test('typed over from before the link into it, the text after stays linked', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await fromInside(ep, page);
		await typeIn(ep, page, 'X');
		expect(await ep.bridge.getSource()).toBe(`ViX[mple](${U}) now`);
	});

	test('Backspace over either edge leaves the same halves linked', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await fromAfter(ep, page);
		await keys(ep, page, 'Backspace');
		expect(await ep.bridge.getSource()).toBe(`Visit [exam](${U})w`);
		await nextRow(ep, DOC);
		await fromInside(ep, page);
		await keys(ep, page, 'Backspace');
		expect(await ep.bridge.getSource()).toBe(`Vi[mple](${U}) now`);
	});

	test('a paste over either edge lands outside the link', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await ep.clipboard.seed('X');
		await fromAfter(ep, page);
		await ep.clipboard.paste();
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getSource()).toBe(`Visit [exam](${U})Xw`);
		await nextRow(ep, DOC);
		await fromInside(ep, page);
		await ep.clipboard.paste();
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getSource()).toBe(`ViX[mple](${U}) now`);
	});

	test('a selection over the link and text on both sides leaves no stray bytes', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await clickEnd(ep, page, 'now');
		await keys(ep, page, 'ArrowLeft', ...Array(14).fill('Shift+ArrowLeft'));
		await typeIn(ep, page, 'X');
		expect(await ep.bridge.getSource()).toBe('ViXw');
	});
});

test.describe('live mode: a block that is only a link, selected whole', () => {
	for (const [name, doc, written] of [
		['a paragraph', LINK, 'x y'],
		['a heading', `# ${LINK}`, '# x y']
	] as const) {
		test(`${name}: Ctrl+A or a triple click, then typing, replaces the link`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'live', doc);
			await clickEnd(ep, page, 'example');
			await keys(ep, page, 'ControlOrMeta+a');
			await typeIn(ep, page, 'x y');
			expect(await ep.bridge.getSource()).toBe(written);
			await nextRow(ep, doc);
			await multiClick(page, await textRunCenter(page, 'example'), 3);
			await ep.waitForRenderFlush();
			await typeIn(ep, page, 'x y');
			expect(await ep.bridge.getSource()).toBe(written);
		});
	}
});

test.describe('live mode: an edit inside a reference keeps its destination', () => {
	const DEF = `\n\n[example]: ${U}`;

	for (const [form, doc] of [
		['a shortcut reference', `Visit [example] now${DEF}`],
		['a collapsed reference', `Visit [example][] now${DEF}`]
	] as const) {
		test(`${form}: typing inside spells the label, the definition untouched`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'live', doc);
			await selectIn(ep, page, 3, 0);
			await typeIn(ep, page, 'a b');
			expect(await ep.bridge.getSource()).toBe(`Visit [exama bple][example] now${DEF}`);
			await nextRow(ep, doc);
			await selectIn(ep, page, 4, 3);
			await typeIn(ep, page, 'X');
			expect(await ep.bridge.getSource()).toBe(`Visit X[mple][example] now${DEF}`);
		});
	}

	// The respelling is the keystroke's own write, a typing entry like any letter.
	test('one undo takes back the first keystroke and its respelling together', async ({ page }) => {
		const doc = `Visit [example] now${DEF}`;
		const ep = await enterPresentationMode(page, 'live', doc);
		await selectIn(ep, page, 3, 0);
		await typeIn(ep, page, 'Z');
		expect(await ep.bridge.getSource()).toBe(`Visit [examZple][example] now${DEF}`);
		await ep.endTypingBatch();
		await ep.undo();
		await ep.waitForRenderFlush();
		expect(await ep.bridge.getSource()).toBe(doc);
	});
});
