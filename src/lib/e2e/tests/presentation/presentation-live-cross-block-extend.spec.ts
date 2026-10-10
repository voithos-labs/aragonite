import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	enterPresentationMode,
	extendTo,
	focusOffset,
	focusPath,
	nextRow
} from './helpers';
import { textOutsideMarkers } from '../../text-runs';

// A block that ends in a construct ends in a run live paints nothing for, so a cross-block
// endpoint taken from the raw length sits past it. The paint, the collapse and the type-over
// all have to answer for that. Each test walks its rows as steps, every step on a fresh copy of
// its document.
// Requirements: e2e/requirements/presentation/presentation-live-cross-block-extend.md.

const DOC = ['Alpha ends with **bold**', '', 'Beta plain line', '', '**Lead** closes here'].join(
	'\n'
);

const ENDS_BOLD = 0;
const PLAIN = 1;
const LEADS_BOLD = 2;

// `Alpha ends with **bold**`: `bold` is [18, 22), so 22 is the last offset the caret can reach
// and 24 is the raw length, the far side of the closing run, which no arrow gets to.
const CONTENT_END = 22;
const RAW_END = 24;

/** The overlay rects the editor painted in `block`, in the block box's own coordinates. */
async function endpointRects(
	page: Page,
	block: number
): Promise<Array<{ left: number; width: number; height: number; boxWidth: number }>> {
	return page.evaluate((index) => {
		const host = document.querySelector(`[data-block-path='[${index}]']`);
		if (!host) return [];
		const box = host.getBoundingClientRect();
		return [...host.querySelectorAll('.selection-overlay-endpoint')].map((el) => {
			const rect = el.getBoundingClientRect();
			return {
				left: rect.left - box.left,
				width: rect.width,
				height: rect.height,
				boxWidth: box.width
			};
		});
	}, block);
}

test('live mode, extending across a construct-ending block', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	await test.step('the paint stays inside the block that ends in a hidden run', async () => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, ENDS_BOLD);
		await page.keyboard.press('Home');
		// One character in, so the range covers the block only in part and measures its text.
		await page.keyboard.press('ArrowRight');
		await extendTo(ep, page, 'ArrowDown', [PLAIN], 0);

		const rects = await endpointRects(page, ENDS_BOLD);
		expect(rects.length).toBeGreaterThan(0);
		for (const rect of rects) {
			expect(rect.width).toBeGreaterThan(0);
			expect(rect.height).toBeGreaterThan(0);
			expect(rect.left).toBeGreaterThanOrEqual(-1);
			expect(rect.left + rect.width).toBeLessThanOrEqual(rect.boxWidth + 1);
		}
	});

	// A selection may cover the run, because a delete that took the content and left the
	// delimiters would strand them, so the extension's own endpoint is the block's raw end.
	await test.step('extending backward into it covers the whole block', async () => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowLeft', [ENDS_BOLD], RAW_END);
		expect(await focusOffset(ep)).toBe(RAW_END);
	});

	// ...but a caret may not: collapsing leaves one, so it lands on the last offset the block
	// allows, which is where every other gesture leaves the caret at that edge.
	await test.step('collapsing that extension lands the caret at the content end', async () => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowLeft', [ENDS_BOLD], RAW_END);

		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();
		await ep.waitForCrossBlock(false);
		expect(await focusPath(ep)).toEqual([ENDS_BOLD]);
		expect(await focusOffset(ep)).toBe(CONTENT_END);
	});

	// A collapse lands on text, where the character before the caret, bold here, decides.
	await test.step('typing at the collapsed caret extends the construct', async () => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowLeft', [ENDS_BOLD], RAW_END);
		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('**boldZ**');
	});

	await test.step('extending backward into a block that begins with a construct reaches its neighbour', async () => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, LEADS_BOLD);
		await page.keyboard.press('Home');
		// `**Lead** closes here`: the opening `**` is unpainted, so 2 is the first reachable offset.
		expect(await focusOffset(ep)).toBe(2);
		await extendTo(ep, page, 'ArrowLeft', [PLAIN], 15);
		expect(await focusPath(ep)).toEqual([PLAIN]);
	});

	await test.step('typing over the extension leaves no delimiter on screen', async () => {
		await nextRow(ep, DOC);
		await clickBlockSettled(ep, ENDS_BOLD);
		await page.keyboard.press('End');
		await extendTo(ep, page, 'ArrowDown', [LEADS_BOLD], 0);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('boldX');

		// The runs the cut stranded went with it: no `*` survives into the visible text, and
		// the construct the range did not reach still renders as one.
		expect(await textOutsideMarkers(ep.getBlock(ENDS_BOLD))).not.toContain('*');
		expect(await ep.bridge.getSource()).not.toContain('****');
	});
});

// A table endpoint collapses through the cell, which prose caret placement does not reach; its
// trap is the cell's own opening run.
const CELL_DOC = [
	'| h1 | h2 |',
	'| --- | --- |',
	'| **bold** cell | plain |',
	'',
	'After table'
].join('\n');

// Every key that collapses a range lands on text, at an opener and at a closer; the whole matrix is
// checked, since one row can be right by coincidence.
const MATRIX_DOC = [
	'Lead **bold**',
	'',
	'Middle plain',
	'',
	'**bold** tail',
	'',
	'Ends with **bold**'
].join('\n');

const CLOSER_FIRST = 0;
const MIDDLE = 1;
const OPENER = 2;

interface CollapseArm {
	edge: 'opener' | 'closer';
	key: 'ArrowLeft' | 'ArrowRight' | 'Escape';
	/** Build a cross-block range whose collapse target is this row's edge. */
	extend: (ep: EditorPage, page: Page) => Promise<void>;
	/** The bytes the letter writes, inside the construct the caret lands against. */
	expected: string;
}

/** Collapse to the range's start: this row's edge has to be the earlier endpoint. */
async function fromOpenerStart(ep: EditorPage, page: Page): Promise<void> {
	await clickBlockSettled(ep, OPENER);
	await page.keyboard.press('Home');
	await extendTo(ep, page, 'ArrowDown', [OPENER + 1], 0);
}

async function fromCloserStart(ep: EditorPage, page: Page): Promise<void> {
	await clickBlockSettled(ep, MIDDLE);
	await page.keyboard.press('Home');
	await extendTo(ep, page, 'ArrowLeft', [CLOSER_FIRST], RAW_END_OF_LEAD);
}

const COLLAPSE_ARMS: CollapseArm[] = [
	{ edge: 'opener', key: 'ArrowLeft', extend: fromOpenerStart, expected: '**Zbold** tail' },
	{ edge: 'opener', key: 'Escape', extend: fromOpenerStart, expected: '**Zbold** tail' },
	{
		edge: 'opener',
		key: 'ArrowRight',
		extend: async (ep, page) => {
			await clickBlockSettled(ep, MIDDLE);
			await page.keyboard.press('End');
			await extendTo(ep, page, 'ArrowDown', [OPENER], 0);
		},
		expected: '**Zbold** tail'
	},
	{ edge: 'closer', key: 'ArrowLeft', extend: fromCloserStart, expected: 'Lead **boldZ**' },
	{ edge: 'closer', key: 'Escape', extend: fromCloserStart, expected: 'Lead **boldZ**' },
	{
		edge: 'closer',
		key: 'ArrowRight',
		extend: async (ep, page) => {
			await clickBlockSettled(ep, MIDDLE);
			await page.keyboard.press('End');
			await page.keyboard.press('ControlOrMeta+Shift+End');
			await ep.waitForCrossBlock(true);
		},
		expected: 'Ends with **boldZ**'
	}
];

/** `Lead **bold**`: 13 raw bytes, the far side of the closing run. */
const RAW_END_OF_LEAD = 13;

test('live mode: a collapse follows the character beside the caret, on both axes', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'live', MATRIX_DOC);

	for (const arm of COLLAPSE_ARMS) {
		await test.step(`${arm.edge} + ${arm.key}: the byte joins the construct`, async () => {
			await nextRow(ep, MATRIX_DOC);
			await arm.extend(ep, page);

			await page.keyboard.press(arm.key);
			await ep.waitForCrossBlock(false);
			await ep.waitForRenderFlush();

			await page.keyboard.type('Z');
			await ep.bridge.waitForSourceContains('Z');
			expect(await ep.bridge.getSource()).toContain(arm.expected);
		});
	}
});

test('live mode, collapsing onto a leading construct', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', '\n');

	// The prose counterpart of the cell case below: the caret lands at a line start, where the
	// character after it decides.
	await test.step('the prose arrival types inside the construct the block opens with', async () => {
		await nextRow(ep, '**bold** para\n\nAfter para\n');
		await clickBlockSettled(ep, 0);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowDown', [1], 0);

		await page.keyboard.press('ArrowLeft');
		await ep.waitForCrossBlock(false);
		await ep.waitForRenderFlush();
		expect(await focusOffset(ep)).toBe(2);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('**Zbold** para');
	});

	await test.step('the cell arrival types inside the construct it opens with', async () => {
		await nextRow(ep, CELL_DOC);
		await clickBlockSettled(ep, 1);
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+ArrowLeft');
		await ep.waitForCrossBlock(true);

		// Collapse to the start, which is the table endpoint, snapped to the row's first cell.
		await page.keyboard.press('ArrowLeft');
		await ep.waitForCrossBlock(false);
		await ep.waitForRenderFlush();

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('| **Zbold** cell |');
	});
});

test('source mode: the endpoints are the raw ones, so the collapse lands where the extension stopped', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'source', DOC);
	await clickBlockSettled(ep, PLAIN);
	await page.keyboard.press('Home');
	await extendTo(ep, page, 'ArrowLeft', [ENDS_BOLD], RAW_END);
	await page.keyboard.press('ArrowLeft');
	await ep.waitForRenderFlush();
	await ep.waitForCrossBlock(false);
	expect(await focusOffset(ep)).toBe(RAW_END);
});
