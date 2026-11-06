import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { gotoReady } from '../../goto-ready';
import { skipUnlessSupported } from '../../browser-engine';
import { pointAtRaw } from '../../text-runs';
import { fingerDrag } from '../../touch';

// How far a drag must reach into a tall block with no positions inside (a table of contents) before
// the block joins the range. Requirements: `e2e/requirements/selection/whole-block-reach.md`.

const HEADINGS = Array.from({ length: 12 }, (_, i) => `## Heading number ${i + 1}`).join('\n\n');
const OUTLINE = (above: string) => `${above}\n\n[[toc]]\n\n${HEADINGS}\n`;
const PROSE = 'alpha beta gamma';
const TABLE = '| apple | berry |\n| --- | --- |\n| cherry | damson |';
// Past the outline's top edge by more than a line, well short of its middle.
const PAST_EDGE = 36;

test.use({ viewport: { width: 390, height: 844 } });

async function open(page: Page, source: string): Promise<{ editor: EditorPage; outline: Box }> {
	const editor = new EditorPage(page);
	await gotoReady(page, '/test/plugins?seed=toc');
	await editor.loadContent(source);
	const outline = page.locator("[data-block-path='[1]']");
	await expect(outline.locator('.toc-block-item').first()).toBeVisible();
	return { editor, outline: (await outline.boundingBox())! };
}

type Box = { x: number; y: number; width: number; height: number };
const focusBlock = (editor: EditorPage) =>
	editor.bridge.getSelectionPaths().then((s) => s?.focus.path[0] ?? null);

for (const [name, above, press] of [
	['a paragraph', PROSE, [0]],
	['a table', TABLE, [0, 1, 0]]
] as const) {
	test(`a mouse drag down from ${name} joins a tall outline only past its centre line, like every other drag`, async ({
		page
	}) => {
		const { editor, outline } = await open(page, OUTLINE(above));
		const from = await pointAtRaw(page, [...press], 2);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x, outline.y + PAST_EDGE, { steps: 8 });
		await expect.poll(() => focusBlock(editor)).toBe(0);
		await page.mouse.move(from.x, outline.y + outline.height / 2 + 4, { steps: 4 });
		await expect.poll(() => focusBlock(editor)).toBe(1);
		await page.mouse.up();
	});
}

test.describe('under a finger', () => {
	test.use({ hasTouch: true });

	test("a finger's end handle a line past a tall outline's edge takes it into the range", async ({
		page
	}) => {
		skipUnlessSupported(page, 'touch');
		skipUnlessSupported(page, 'cdp');
		const { editor, outline } = await open(page, OUTLINE(PROSE));
		const word = await pointAtRaw(page, [0], 2);
		await page.touchscreen.tap(word.x, word.y);
		await page.touchscreen.tap(word.x, word.y);
		await expect(page.locator('.selection-handle')).toHaveCount(2);
		const end = await pointAtRaw(page, [0], 5);
		const box = (await page.locator('.selection-handle[data-handle="end"]').boundingBox())!;
		const x = Math.round(box.x + box.width / 2);
		const y = Math.round(box.y + box.height / 2);
		await fingerDrag(page, { x, y }, { x, y: Math.round(y + outline.y + PAST_EDGE - end.y) });
		await expect.poll(() => focusBlock(editor)).toBe(1);
	});
});
