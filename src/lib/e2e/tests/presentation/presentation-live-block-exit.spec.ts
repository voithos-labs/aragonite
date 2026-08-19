import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, focusOffset, focusPath, press } from './helpers';

// A hidden run at a block's edge puts the raw edge out of the caret's reach, so the horizontal
// exit gates fire at the walk's landable bound instead (#103). The selection bridge is the
// oracle: only the browser knows which DOM position a key left behind.
// Requirements: e2e/requirements/presentation/presentation-live-block-exit.md.

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
	'- **lead** item',
	'- second',
	'',
	'| a | b |',
	'| --- | --- |',
	'| [text][ref] | y |',
	'',
	'[ref]: https://example.com'
].join('\n');

const BOLD_MID = 1;
const BOLD_LEAD = 2;
const CODE = 3;
const LIST = 4;
const TABLE = 5;

async function clickCell(ep: EditorPage, page: Page, text: string): Promise<void> {
	const cell = page.locator("[role='table'] [contenteditable='true']").filter({ hasText: text });
	await cell.first().click();
	await ep.waitForRenderFlush();
	await expect.poll(() => focusOffset(ep), { timeout: 2000 }).toBeGreaterThanOrEqual(0);
}

test.describe('live mode — a horizontal exit fires at the landable bound', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	// `**Lead** in`: the opening `**` is unpainted, so raw 0 is a position no key produces.
	test('a paragraph opening with a hidden run exits leftward from its landable start', async ({
		page
	}) => {
		await clickBlockSettled(ep, BOLD_LEAD);
		expect(await press(ep, page, 'Home')).toBe(2);
		await press(ep, page, 'ArrowLeft');
		expect(await focusPath(ep)).toEqual([BOLD_MID]);
		expect(await focusOffset(ep)).toBe(18);
	});

	// The opener fence line owns its trailing newline, so the body starts at raw 6.
	test('a fenced code block exits leftward from its body start', async ({ page }) => {
		await clickBlockSettled(ep, CODE);
		expect(await press(ep, page, 'Home')).toBe(6);
		await press(ep, page, 'ArrowLeft');
		expect(await focusPath(ep)).toEqual([BOLD_LEAD]);
	});

	// The closer's fence line owns the newline BEFORE it, so the body ends at raw 18.
	test('a fenced code block exits rightward from its body end', async ({ page }) => {
		await clickBlockSettled(ep, CODE);
		expect(await press(ep, page, 'End')).toBe(18);
		await press(ep, page, 'ArrowRight');
		expect((await focusPath(ep))[0]).toBe(LIST);
	});

	// The ambient `- ` is an inert island and the `**` behind it is unpainted: the item's
	// landable start clears both, and the press leaves rather than stepping between them.
	test('a list item opening with a hidden run exits leftward', async ({ page }) => {
		await page.getByText('item').first().click();
		await ep.waitForRenderFlush();
		await press(ep, page, 'Home');
		await press(ep, page, 'ArrowLeft');
		expect(await focusPath(ep)).toEqual([CODE]);
	});

	test('extending leftward from a landable start reaches the previous block', async ({ page }) => {
		await clickBlockSettled(ep, BOLD_LEAD);
		await press(ep, page, 'Home');
		await page.keyboard.press('Shift+ArrowLeft');
		await ep.waitForRenderFlush();
		expect(await focusPath(ep)).toEqual([BOLD_MID]);
	});

	// A block that opens with painted bytes keeps raw 0 as its exit — the bound only moves
	// where the mode paints nothing.
	test('a block whose content starts at raw 0 exits from raw 0', async ({ page }) => {
		await clickBlockSettled(ep, BOLD_MID);
		expect(await press(ep, page, 'Home')).toBe(0);
		await press(ep, page, 'ArrowLeft');
		expect(await focusPath(ep)).toEqual([0]);
	});
});

test.describe('live mode — a table cell hops at ITS landable bound', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	// `[text][ref]`: `]`, `[ref]` and the closing bracket are all unpainted, so the cell's
	// landable end is 5 and the hop must fire there rather than at raw 11.
	test('a cell ending in a hidden tail hops to the next cell', async ({ page }) => {
		await clickCell(ep, page, 'text');
		expect(await press(ep, page, 'End')).toBe(5);
		await press(ep, page, 'ArrowRight');
		expect(await focusPath(ep)).toEqual([TABLE, 1, 1]);
		expect(await focusOffset(ep)).toBe(0);
	});

	// Row-major: the previous cell of the first body column is the LAST header cell, entered
	// at its end — the prose prelude's sibling-index move lands in neither.
	test('a cell opening with a hidden bracket hops to the previous cell', async ({ page }) => {
		await clickCell(ep, page, 'text');
		expect(await press(ep, page, 'Home')).toBe(1);
		await press(ep, page, 'ArrowLeft');
		expect(await focusPath(ep)).toEqual([TABLE, 0, 1]);
		expect(await focusOffset(ep)).toBe(1);
	});
});

// The cell's bounds are deliberately mode-unguarded: they follow what the screen shows. In
// preview-inline a ref label is hidden until the caret's proximity reveals it, so the same hop
// fires there — the dead key was never live-only.
test.describe('preview-inline — a cell hops at whatever is hidden right now', () => {
	test('a cell ending in an unrevealed ref label hops to the next cell', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'preview-inline', DOC);
		await clickCell(ep, page, 'text');
		// The offset End reaches depends on what the caret's proximity revealed, which is the
		// dependence being pinned; the hop is the contract, and at raw 11 it fired already.
		expect(await press(ep, page, 'End')).toBeLessThan(11);
		await press(ep, page, 'ArrowRight');
		expect(await focusPath(ep)).toEqual([TABLE, 1, 1]);
	});
});

test.describe('source mode — every marker is painted, so nothing moves in', () => {
	test('the same presses step inside the block', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await clickBlockSettled(ep, BOLD_LEAD);
		expect(await press(ep, page, 'Home')).toBe(0);
		await press(ep, page, 'ArrowLeft');
		expect(await focusPath(ep)).toEqual([BOLD_MID]);

		// Home is line-relative in both modes; what differs is that the painted fence keeps
		// raw 5 reachable, so the press steps into it instead of leaving.
		await clickBlockSettled(ep, CODE);
		expect(await press(ep, page, 'Home')).toBe(6);
		expect(await press(ep, page, 'ArrowLeft')).toBe(5);
		expect(await focusPath(ep)).toEqual([CODE]);
	});
});
