import { type Locator, type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { gotoReady } from '../../goto-ready';
import { MermaidPage } from './mermaid-helpers';

/**
 * A block that swaps to a shorter view at the end of a windowed document costs the reader only the
 * height it lost (requirements/plugins/view-swap-end-scroll.md). Every swap, in both scroll modes
 * and on the showcase itself, ends with the scroll container at its bottom and the block in view.
 */

const TALL_DIAGRAM = [
	'```mermaid',
	'xychart-beta',
	'    title "productivity vs. caffeine"',
	'    x-axis "Cups" [0, 1, 2, 3, 4, 5, 6]',
	'    y-axis "10x Engineer Units" 0 --> 1000',
	'    line [5, 40, 160, 480, 950, 0, 0]',
	'```'
].join('\n');

const OPEN_DETAILS = [
	'<details open>',
	'<summary>Summary</summary>',
	'',
	...Array.from({ length: 12 }, (_, i) => `Body paragraph ${i} of the open details.\n`),
	'</details>'
].join('\n');

// Long enough to turn windowing on, with quotes and lists between the paragraphs: a container that
// mounts as the window grows upward lays out its own list while its later siblings are still to come.
const FILLER = Array.from({ length: 150 }, (_, i) =>
	i % 3 === 1
		? `> Quote ${i}, which is its own block list.\n> A second line.`
		: i % 3 === 2
			? `- Item ${i}a\n- Item ${i}b`
			: `Paragraph ${i} of filler prose, long enough to wrap onto a second line in the narrow harness.`
).join('\n\n');

// Sub-pixel block heights can leave a scroll container a pixel short of its maximum.
const END_SLACK = 2;

interface Geometry {
	scrollTop: number;
	maxScrollTop: number;
	windowed: boolean;
	blockTop: number;
	blockBottom: number;
	portTop: number;
	portBottom: number;
}

/** The scroll container and the swapped block, in viewport pixels. */
function geometry(page: Page, portSelector: string, blockSelector: string): Promise<Geometry> {
	return page.evaluate(
		([portSel, blockSel]) => {
			const port = document.querySelector(portSel) as HTMLElement;
			const block = [...document.querySelectorAll(blockSel)].pop() as HTMLElement;
			const portRect = port.getBoundingClientRect();
			const blockRect = block.getBoundingClientRect();
			return {
				scrollTop: port.scrollTop,
				maxScrollTop: port.scrollHeight - port.clientHeight,
				windowed: document.querySelector('.editor .vr-spacer') !== null,
				blockTop: blockRect.top,
				blockBottom: blockRect.bottom,
				portTop: portRect.top,
				portBottom: portRect.top + port.clientHeight
			};
		},
		[portSelector, blockSelector]
	);
}

/** Wheel down until the scroll container stops at its bottom, the way a reader gets there. Short
 *  steps mount and measure every block on the way, so no estimate is left to correct at the end. */
async function wheelToBottom(page: Page, port: Locator): Promise<void> {
	const box = (await port.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect
		.poll(
			async () => {
				await page.mouse.wheel(0, 400);
				return port.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
			},
			{ timeout: 40_000, intervals: [50] }
		)
		.toBeLessThan(END_SLACK);
}

interface Swap {
	name: string;
	/** The document's last block, which the swap shortens. */
	tail: string;
	block: string;
	/** Waits for the block's resting view once the bottom has mounted it. */
	settle(page: Page): Promise<void>;
	/** The user's gesture that swaps the view, and a wait for the new one. */
	run(page: Page, block: Locator): Promise<void>;
}

const diagramSettle = (page: Page) =>
	expect(page.locator('.mermaid-viewport svg').last()).toBeVisible({ timeout: 30_000 });

async function diagramTop(block: Locator) {
	const box = (await block.locator('.mermaid-viewport').boundingBox())!;
	return { x: box.x + box.width / 2, y: box.y + 20 };
}

const EDIT_BUTTON: Swap = {
	name: 'the diagram Edit button',
	tail: TALL_DIAGRAM,
	block: '.mermaid-block',
	settle: diagramSettle,
	async run(page, block) {
		// The click focuses the block, which brings up the hover-only toolbar.
		const at = await diagramTop(block);
		await page.mouse.click(at.x, at.y);
		await block.getByTestId('mermaid-edit').click();
		await expect(block.getByTestId('mermaid-source')).toBeFocused();
	}
};

const DIAGRAM_DOUBLE_CLICK: Swap = {
	name: 'a double click on the diagram',
	tail: TALL_DIAGRAM,
	block: '.mermaid-block',
	settle: diagramSettle,
	async run(page, block) {
		const at = await diagramTop(block);
		await page.mouse.dblclick(at.x, at.y);
		await expect(block.getByTestId('mermaid-source')).toBeFocused();
	}
};

const DETAILS_COLLAPSE: Swap = {
	name: 'collapsing an open details block',
	tail: OPEN_DETAILS,
	block: '.details-block',
	settle: (page) => expect(page.locator('.details-block').last()).toBeVisible(),
	async run(page, block) {
		const toggle = block.locator('.details-toggle').first();
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	}
};

async function swapAtTheEnd(
	page: Page,
	portSelector: string,
	swap: Swap,
	flush: () => Promise<void>
): Promise<void> {
	const port = page.locator(portSelector);
	const block = page.locator(swap.block).last();
	await wheelToBottom(page, port);
	await swap.settle(page);
	await wheelToBottom(page, port);
	await flush();
	const before = await geometry(page, portSelector, swap.block);
	// A fixture that stopped windowing would pass for nothing.
	expect(before.windowed).toBe(true);
	expect(before.maxScrollTop - before.scrollTop).toBeLessThan(END_SLACK);

	await swap.run(page, block);
	await flush();
	await flush();

	const after = await geometry(page, portSelector, swap.block);
	// Nor would a swap that stopped taking height out of the document.
	expect(before.maxScrollTop - after.maxScrollTop).toBeGreaterThan(100);
	expect(after.maxScrollTop - after.scrollTop).toBeLessThan(END_SLACK);
	expect(after.blockTop).toBeGreaterThanOrEqual(after.portTop - 1);
	expect(after.blockBottom).toBeLessThanOrEqual(after.portBottom + 1);
}

test.describe('a view swap at the end of a windowed document keeps the reader at the end', () => {
	for (const scrollMode of ['self', 'host'] as const) {
		const portSelector = scrollMode === 'host' ? '.plugins-harness' : '.editor';
		for (const swap of [EDIT_BUTTON, DIAGRAM_DOUBLE_CLICK, DETAILS_COLLAPSE]) {
			test(`${swap.name}, ${scrollMode} scroll`, async ({ page }) => {
				const editor = new MermaidPage(page);
				await gotoReady(page, `/test/plugins?seed=mermaid&scroll=${scrollMode}`);
				await editor.loadContent(`${FILLER}\n\n${swap.tail}\n`);
				await swapAtTheEnd(page, portSelector, swap, () => editor.waitForRenderFlush());
			});
		}
	}

	// The showcase is where it was reported: its own document, live mode, the editor scrolling.
	for (const swap of [EDIT_BUTTON, DIAGRAM_DOUBLE_CLICK]) {
		test(`${swap.name} on the showcase`, async ({ page }) => {
			const editor = new MermaidPage(page);
			await gotoReady(page, '/');
			await swapAtTheEnd(page, '.editor', swap, () => editor.waitForRenderFlush());
		});
	}
});
