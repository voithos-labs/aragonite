import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { centerOfWord } from './helpers';

// Live-mode caret edges: no caret reports from inside a hidden marker run, and the block's
// exits and destructive keys read its content bounds. jsdom cannot see where Chromium drops
// an element-level caret, so the selection bridge is the oracle for every offset here.
// Requirements: e2e/requirements/presentation/presentation-live-affinity.md.

const DOC = [
	'## Sub',
	'',
	'Some **bold** text',
	'',
	'**Lead** in',
	'',
	'```js',
	'const x = 1;',
	'```',
	'',
	'| a | b |',
	'| --- | --- |',
	'| [text][ref] | y |',
	'',
	'[ref]: https://example.com'
].join('\n');

const HEADING = 0;
const BOLD_MID = 1;
const BOLD_LEAD = 2;
const CODE = 3;

// The attribute check is load-bearing: an unwhitelisted query param falls back to source,
// where every offset below is the ordinary one and the spec would pass without live.
async function enterLive(page: Page): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto('?presentationMode=live');
	await ep.loadContent(DOC);
	await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');
	return ep;
}

async function focusOffset(ep: EditorPage): Promise<number> {
	return (await ep.bridge.getSelectionPaths())?.focus.offset ?? -1;
}

async function focusPath(ep: EditorPage): Promise<number[]> {
	return (await ep.bridge.getSelectionPaths())?.focus.path ?? [];
}

async function press(ep: EditorPage, page: Page, key: string, times = 1): Promise<number> {
	for (let i = 0; i < times; i++) await page.keyboard.press(key);
	await ep.waitForRenderFlush();
	return focusOffset(ep);
}

test.describe('live mode — the caret never reports from inside a hidden run', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// `## Sub`: the `## ` is unpainted, so the first offset a caret can occupy is 3.
	test('Home in a heading lands at the content start, not raw 0', async ({ page }) => {
		await ep.clickBlock(HEADING);
		expect(await press(ep, page, 'Home')).toBe(3);
		expect(await press(ep, page, 'End')).toBe(6);
	});

	// `**Lead** in`: the opening `**` is unpainted, so Home lands past it.
	test('Home in a paragraph opening with a construct lands after the marker', async ({ page }) => {
		await ep.clickBlock(BOLD_LEAD);
		expect(await press(ep, page, 'Home')).toBe(2);
		expect(await press(ep, page, 'End')).toBe(11);
	});

	// `Some **bold** text`: strong is [5,13), `bold` is [7,11). From raw 14 (before `t`) one
	// press crosses the space AND the whole closing `**`, stopping on `bold`'s last byte.
	test('ArrowLeft crosses a whole hidden run in one press, stopping at the content edge', async ({
		page
	}) => {
		await ep.clickBlock(BOLD_MID);
		await press(ep, page, 'End');
		expect(await press(ep, page, 'ArrowLeft', 4)).toBe(14);
		expect(await press(ep, page, 'ArrowLeft')).toBe(11);
		expect(await press(ep, page, 'ArrowLeft')).toBe(10);
	});

	// 6 and 12 are the runs' interiors; 7 and 13 their far sides, which the canonicalizing
	// read never chooses either. The walk must still reach the block end.
	test('a rightward walk skips both marker runs whole and reaches the block end', async ({
		page
	}) => {
		await ep.clickBlock(BOLD_MID);
		const seen = [await press(ep, page, 'Home')];
		for (let i = 0; i < 14; i++) seen.push(await press(ep, page, 'ArrowRight'));
		expect(seen.filter((o) => [6, 7, 12, 13].includes(o))).toEqual([]);
		expect(seen).toContain(18);
	});

	test('ArrowRight at the block end still exits into the next block', async ({ page }) => {
		await ep.clickBlock(BOLD_MID);
		await press(ep, page, 'End');
		await press(ep, page, 'ArrowRight');
		expect(await focusPath(ep)).toEqual([BOLD_LEAD]);
	});

	test('ArrowUp and ArrowDown still exit at the first and last visual line', async ({ page }) => {
		await ep.clickBlock(BOLD_MID);
		await press(ep, page, 'Home');
		await press(ep, page, 'ArrowUp');
		expect(await focusPath(ep)).toEqual([HEADING]);
		// Landing in the heading is past its unpainted prefix, like every other arrival.
		expect(await focusOffset(ep)).toBeGreaterThanOrEqual(3);

		await press(ep, page, 'ArrowDown');
		expect(await focusPath(ep)).toEqual([BOLD_MID]);
	});
});

test.describe('live mode — destructive keys at a hidden structural edge', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	// The press is consumed rather than left to the engine, so no byte moves and no merge
	// fires — the two outcomes a content-start Backspace could otherwise produce.
	test('Backspace at a heading’s content start changes nothing and does not merge', async ({
		page
	}) => {
		await ep.clickBlock(HEADING);
		await press(ep, page, 'Home');
		const before = await ep.bridge.getSource();

		await page.keyboard.press('Backspace');
		await ep.waitForNoSourceMutation();

		expect(await ep.bridge.getSource()).toBe(before);
		expect(await ep.bridge.getBlockKind(HEADING)).toBe('heading');
		expect(await focusOffset(ep)).toBe(3);
	});

	// The swallow claims only a caret against a hidden prefix; an ordinary block start merges.
	test('Backspace at a paragraph’s start still merges with the previous block', async ({
		page
	}) => {
		await ep.clickBlock(BOLD_MID);
		// `Some …` opens with visible bytes, so Home reaches raw 0 and the merge is reachable.
		expect(await press(ep, page, 'Home')).toBe(0);
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('## SubSome **bold** text');
	});
});

test.describe('live mode — hidden runs a caret must not be able to type into', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('entering a code block by block exit lands in the body, not the hidden fence', async ({
		page
	}) => {
		await ep.clickBlock(BOLD_LEAD);
		await press(ep, page, 'End');
		await press(ep, page, 'ArrowRight');
		expect(await focusPath(ep)).toEqual([CODE]);
		await press(ep, page, 'Home');

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('```js\nZconst x = 1;\n```');
	});

	test('clicking into a code block body types there and leaves both fences intact', async ({
		page
	}) => {
		const point = await centerOfWord(page, 'const');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();
		expect(await focusPath(ep)).toEqual([CODE]);

		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceMatches(/```js\n[^`]*Y[^`]*\n```/);
	});

	// `[text][ref]` in a cell: `[`, `]` and the whole `[ref]` label are unpainted, so the
	// only reachable offsets are inside `text`.
	test('a table cell’s reference label is unreachable and untypeable', async ({ page }) => {
		const cell = page
			.locator("[role='table'] [contenteditable='true']")
			.filter({ hasText: 'text' });
		await cell.first().click();
		await ep.waitForRenderFlush();

		expect(await press(ep, page, 'End')).toBe(5);
		expect(await press(ep, page, 'Home')).toBe(1);

		await press(ep, page, 'End');
		await page.keyboard.type('Q');
		await ep.bridge.waitForSourceContains('| [textQ][ref] | y |');
	});
});
