import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import {
	FIXTURE_BYTES,
	TOP_LEVEL_HOSTS,
	settleFrames,
	spacerCount,
	startCountingHostChanges
} from './vr-helpers';

// A change to the blocks of a document below the windowing threshold, an edit or a swap of
// the whole document, mounts every block and keeps the untouched ones: the block list decides
// whether to window from the children it receives, so none drops out for one pass.

const PIXEL_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PARAGRAPHS = 30;
const PROSE = Array.from({ length: PARAGRAPHS }, (_, i) => `Paragraph ${i}`).join('\n\n');
const PROSE_THEN_IMAGE = `${PROSE}\n\n![tail](${PIXEL_PNG})\n`;
const FIVE_ITEMS = '- a\n- b\n- c\n- d\n- e\n';
const PASTED_PARAGRAPHS = 40;
const PASTE = Array.from({ length: PASTED_PARAGRAPHS }, (_, i) => `Pasted ${i}`).join('\n\n');

/** Holds on to an element found now, so a later check can tell whether it is the same node. */
function holdElement(page: Page, name: string, selector: string): Promise<void> {
	return page.evaluate(
		({ name, selector }) => {
			const all = document.querySelectorAll(`.editor ${selector}`);
			(window as any)[name] = all[all.length - 1];
		},
		{ name, selector }
	);
}

function stillMounted(page: Page, name: string, selector: string): Promise<boolean> {
	return page.evaluate(
		({ name, selector }) => {
			const all = document.querySelectorAll(`.editor ${selector}`);
			const held = (window as any)[name] as Element | undefined;
			return !!held && held.isConnected && held.isSameNode(all[all.length - 1]);
		},
		{ name, selector }
	);
}

test.describe('an edit in an unwindowed document keeps the blocks after it mounted', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter mid-document keeps the image at the end', async ({ page }) => {
		await editor.loadContent(PROSE_THEN_IMAGE);
		await settleFrames(page);
		await holdElement(page, '__tailImage', 'img');
		const hostChanges = await startCountingHostChanges(page);

		await editor.clickBlockAtPath([5], 'Paragraph 5'.length);
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(PARAGRAPHS + 2);
		await settleFrames(page);

		expect(await hostChanges()).toEqual({ added: 1, removed: 0 });
		expect(await stillMounted(page, '__tailImage', 'img')).toBe(true);
		expect(await spacerCount(page)).toBe(0);
	});

	test('Enter in a middle list item keeps the last item', async ({ page }) => {
		await editor.loadContent(FIVE_ITEMS);
		await settleFrames(page);
		await holdElement(page, '__lastItem', '.list-item-block');
		const hostChanges = await startCountingHostChanges(page);

		await editor.clickBlockAtPath([0, 1, 0], 1);
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editor.waitForListItemCount(6);
		await settleFrames(page);

		expect(await hostChanges()).toEqual({ added: 1, removed: 0 });
		expect(await stillMounted(page, '__lastItem', '.list-item-block')).toBe(true);
	});

	// Forty paragraphs is more than any fixed allowance for growth a slice could grant.
	test('a paste of forty paragraphs above the image keeps it', async ({ page }) => {
		await editor.loadContent(PROSE_THEN_IMAGE);
		await settleFrames(page);
		await holdElement(page, '__tailImage', 'img');
		await editor.seedClipboard(PASTE);

		await editor.clickBlockAtPath([5], 'Paragraph 5'.length);
		await page.keyboard.press('End');
		await editor.paste();
		await editor.bridge.waitForSourceContains(`Pasted ${PASTED_PARAGRAPHS - 1}`);
		await settleFrames(page);

		expect(await stillMounted(page, '__tailImage', 'img')).toBe(true);
		expect(await spacerCount(page), 'the paste pushed the document into windowing').toBe(0);
	});
});

/** Every top-level block mounted, no spacers, and the last block readable at the bottom. */
async function expectWholeDocumentAtBottom(page: Page, blockCount: number): Promise<void> {
	expect(await page.locator(`.editor ${TOP_LEVEL_HOSTS}`).count()).toBe(blockCount);
	expect(await spacerCount(page)).toBe(0);
	await page.evaluate(() => {
		const scroller = document.querySelector('.editor') as HTMLElement;
		scroller.scrollTop = scroller.scrollHeight;
	});
	await settleFrames(page);
	const last = page.locator(`.editor [data-block-path="[${blockCount - 1}]"]`);
	await expect(last).toBeInViewport();
}

test.describe('a swap to a medium document mounts every block', () => {
	test('from one block', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('one\n');
		await editor.loadContent(PROSE);
		await settleFrames(page);
		await expectWholeDocumentAtBottom(page, PARAGRAPHS);
	});

	test('from a windowed multi-thousand-block document', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);
		expect(await spacerCount(page), 'the large document is not windowed').toBeGreaterThan(0);
		await editor.loadContent(PROSE);
		await settleFrames(page);
		await expectWholeDocumentAtBottom(page, PARAGRAPHS);
	});
});
