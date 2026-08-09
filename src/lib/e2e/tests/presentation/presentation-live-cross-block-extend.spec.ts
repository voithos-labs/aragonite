import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, extendTo, focusOffset } from './helpers';

// A block that ends in a construct ends in a run live paints nothing for, so a cross-block
// endpoint taken from the raw length sits past it. The paint, the collapse and the type-over
// all have to answer for that.
// Requirements: e2e/requirements/presentation/presentation-live-cross-block-extend.md.

const DOC = ['Alpha ends with **bold**', '', 'Beta plain line', '', '**Lead** closes here'].join(
	'\n'
);

const ENDS_BOLD = 0;
const PLAIN = 1;
const LEADS_BOLD = 2;

// `Alpha ends with **bold**`: `bold` is [18, 22), so 22 is the last landable offset and 24 the
// raw length — the far side of the closing run, which no arrow walk can reach.
const CONTENT_END = 22;
const RAW_END = 24;

async function focusPath(ep: EditorPage): Promise<number[]> {
	return (await ep.bridge.getSelectionPaths())?.focus.path ?? [];
}

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

/** What the block shows: its text minus every span a marker-hiding mode paints nothing for. */
async function visibleText(page: Page, block: number): Promise<string> {
	return page.evaluate((index) => {
		const host = document.querySelector(`[data-block-path='[${index}]']`);
		if (!host) return '';
		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		let out = '';
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (!node.parentElement?.closest('.md-marker, .md-ref-label, .md-fence-line')) {
				out += node.textContent ?? '';
			}
		}
		return out;
	}, block);
}

test.describe('live mode — extending across a construct-ending block', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	test('the paint stays inside the block that ends in a hidden run', async ({ page }) => {
		await clickBlockSettled(ep, ENDS_BOLD);
		await page.keyboard.press('Home');
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

	// A SELECTION may cover the run — a delete that took the content and left the delimiters
	// would strand them — so the extension's own endpoint is the block's raw end.
	test('extending backward into it covers the whole block', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowLeft', [ENDS_BOLD], RAW_END);
		expect(await focusOffset(ep)).toBe(RAW_END);
	});

	// ...but a CARET may not: the collapse seats one, so it lands on the last offset the block
	// can land, which is where every other gesture leaves the caret at that edge.
	test('collapsing that extension lands the caret at the content end', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowLeft', [ENDS_BOLD], RAW_END);

		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();
		await ep.waitForCrossBlock(false);
		expect(await focusPath(ep)).toEqual([ENDS_BOLD]);
		expect(await focusOffset(ep)).toBe(CONTENT_END);
	});

	// The § 5 arrival rule read off the collapse: the caret got there by arrow, from outside,
	// so the byte lands after the construct rather than extending it.
	test('typing at the collapsed caret writes past the construct', async ({ page }) => {
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowLeft', [ENDS_BOLD], RAW_END);
		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('**bold**Z');
	});

	test('extending backward into a block that BEGINS with a construct reaches its neighbour', async ({
		page
	}) => {
		await clickBlockSettled(ep, LEADS_BOLD);
		await page.keyboard.press('Home');
		// `**Lead** closes here`: the opening `**` is unpainted, so 2 is the landable start.
		expect(await focusOffset(ep)).toBe(2);
		await extendTo(ep, page, 'ArrowLeft', [PLAIN], 15);
		expect(await focusPath(ep)).toEqual([PLAIN]);
	});

	test('typing over the extension leaves no delimiter on screen', async ({ page }) => {
		await clickBlockSettled(ep, ENDS_BOLD);
		await page.keyboard.press('End');
		await extendTo(ep, page, 'ArrowDown', [LEADS_BOLD], 0);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('boldX');

		// The runs the cut stranded went with it: no `*` survives into the visible text, and
		// the construct the range did not reach still renders as one.
		expect(await visibleText(page, ENDS_BOLD)).not.toContain('*');
		expect(await ep.bridge.getSource()).not.toContain('****');
	});
});

// A table endpoint collapses through the CELL, which used to seat by itself — the one arrival
// in this file the prose seat never reached. Its trap is the block-entry trap one level down:
// the cell's own opening run.
const CELL_DOC = [
	'| h1 | h2 |',
	'| --- | --- |',
	'| **bold** cell | plain |',
	'',
	'After table'
].join('\n');

test.describe('live mode — collapsing onto a leading construct', () => {
	// The prose twin, measured red beside the cell one: a collapse is not a step, so the arrow's
	// direction is the wrong side to read — the caret jumped to the range's edge.
	test('the prose arrival types outside the construct the block opens with', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', '**bold** para\n\nAfter para\n');
		await clickBlockSettled(ep, 0);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowDown', [1], 0);

		await page.keyboard.press('ArrowLeft');
		await ep.waitForCrossBlock(false);
		await ep.waitForRenderFlush();
		expect(await focusOffset(ep)).toBe(2);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('Z**bold** para');
	});

	test('the cell arrival types outside the construct it opens with', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', CELL_DOC);
		await clickBlockSettled(ep, 1);
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+ArrowLeft');
		await ep.waitForCrossBlock(true);

		// Collapse to the START, which is the table endpoint (row-snapped to its first cell).
		await page.keyboard.press('ArrowLeft');
		await ep.waitForCrossBlock(false);
		await ep.waitForRenderFlush();

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('| Z**bold** cell |');
	});
});

test.describe('source mode — the endpoints are the raw ones', () => {
	test('the collapse lands where the extension stopped', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await clickBlockSettled(ep, PLAIN);
		await page.keyboard.press('Home');
		await extendTo(ep, page, 'ArrowLeft', [ENDS_BOLD], RAW_END);
		await page.keyboard.press('ArrowLeft');
		await ep.waitForRenderFlush();
		await ep.waitForCrossBlock(false);
		expect(await focusOffset(ep)).toBe(RAW_END);
	});
});
