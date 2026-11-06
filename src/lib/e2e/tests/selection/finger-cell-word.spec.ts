import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';
import { fingerDrag, openTouch } from '../../touch';
import { createClipboardArm, type ClipboardArm } from '../../clipboard-arm';
import { multiClick } from '../../multi-click';
import { insertText } from '../../insert-text';

// A finger's word in a table cell is the editor's own range, as a finger's word in any other block
// is, and acts as a mouse's word in that cell does. Requirements:
// `e2e/requirements/selection/finger-cell-word.md`.

const TABLE = 'lead line\n\n| apple pie | berry |\n| --- | --- |\n| cherry | damson |\n';
const APPLE = { path: [1, 0, 0], length: 5 };
const BERRY = { path: [1, 0, 1], length: 5 };
const cellBox = (page: Page, row: number, col: number) =>
	page
		.locator(
			`[role="table"] [data-table-row-idx="${row}"] > :is([role="cell"], [role="columnheader"])`
		)
		.nth(col)
		.boundingBox();

test.use({ hasTouch: true });

type Word = typeof APPLE;
const selection = (editor: EditorPage) => editor.bridge.getSelectionPaths();

async function fingerWord(page: Page, editor: EditorPage, word: Word): Promise<void> {
	const point = await pointAtRaw(page, word.path, 2);
	await page.touchscreen.tap(point.x, point.y);
	await page.touchscreen.tap(point.x, point.y);
	await expect.poll(() => editor.bridge.ownsRange()).toBe(true);
}

async function mouseWord(page: Page, editor: EditorPage, word: Word): Promise<void> {
	const point = await pointAtRaw(page, word.path, 2);
	await multiClick(page, point, 2);
	const { path, length } = word;
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: { path, offset: 0 }, focus: { path, offset: length } });
}

async function tapToolbar(page: Page, name: string): Promise<void> {
	const box = (await page.locator(`[data-testid="toolbar-${name}"]`).boundingBox())!;
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

const nativeCollapsed = (page: Page) =>
	page.evaluate(() => document.getSelection()?.isCollapsed !== false);

test("a finger's double tap in a cell makes its word the editor's range", async ({ page }) => {
	const editor = await openTouch(page, TABLE);
	await fingerWord(page, editor, APPLE);
	expect(await selection(editor)).toEqual({
		anchor: { path: APPLE.path, offset: 0 },
		focus: { path: APPLE.path, offset: 5 }
	});
	expect(await nativeCollapsed(page)).toBe(true);
	await expect(page.locator('.selection-handle')).toHaveCount(2);
	const cell = (await cellBox(page, 0, 0))!;
	const paint = page.locator('[data-block-path="[1]"] .selection-overlay');
	await expect(paint).toHaveCount(1);
	const rect = (await paint.boundingBox())!;
	expect(rect.x).toBeGreaterThanOrEqual(cell.x);
	expect(rect.x + rect.width).toBeLessThan(cell.x + cell.width);
	expect(rect.y).toBeGreaterThanOrEqual(cell.y);
	expect(rect.y + rect.height).toBeLessThanOrEqual(cell.y + cell.height);
});

interface Action {
	name: string;
	word?: Word;
	clipboard?: string;
	act(page: Page, finger: boolean, clipboard: ClipboardArm): Promise<unknown>;
}

const ACTIONS: Action[] = [
	{ name: 'a typed letter', act: (page) => page.keyboard.press('x') },
	{ name: 'a typed pipe', act: (page) => insertText(page, '|') },
	{ name: 'Backspace', act: (page) => page.keyboard.press('Backspace') },
	{
		name: "Backspace over the cell's whole text",
		word: BERRY,
		act: (page) => page.keyboard.press('Backspace')
	},
	{
		name: 'a cut',
		act: (page, finger) =>
			finger ? tapToolbar(page, 'cut') : page.keyboard.press('ControlOrMeta+x')
	},
	{
		name: 'a copy',
		act: (page, finger) =>
			finger ? tapToolbar(page, 'copy') : page.keyboard.press('ControlOrMeta+c')
	},
	{
		name: 'a paste of a pipe',
		clipboard: 'a|b',
		act: (page, finger, clipboard) => (finger ? tapToolbar(page, 'paste') : clipboard.paste())
	},
	{
		name: "the toolbar's bold",
		act: async (page, finger) => {
			const bold = page.locator('[data-testid="toolbar-format.toggleStrong"]');
			if (!finger) return bold.click();
			const box = (await bold.boundingBox())!;
			await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
		}
	},
	{ name: 'Shift+ArrowRight', act: (page) => page.keyboard.press('Shift+ArrowRight') }
];

for (const action of ACTIONS) {
	test(`${action.name} over a finger's word in a cell does what it does over a mouse's word there`, async ({
		page
	}) => {
		const word = action.word ?? APPLE;
		const outcome = async (finger: boolean) => {
			const editor = await openTouch(page, TABLE);
			const clipboard = createClipboardArm(page);
			await clipboard.seed(action.clipboard ?? 'before');
			await (finger ? fingerWord : mouseWord)(page, editor, word);
			await action.act(page, finger, clipboard);
			// Settled once the source and the clipboard stop changing between two reads.
			let last = '';
			await expect
				.poll(async () => {
					const now = JSON.stringify([
						await editor.bridge.getSource(),
						await selection(editor),
						await clipboard.read()
					]);
					const settled = now === last;
					last = now;
					return settled;
				})
				.toBe(true);
			return JSON.parse(last);
		};
		const mouse = await outcome(false);
		expect(await outcome(true)).toEqual(mouse);
	});
}

test("a finger's word's end handle grows it into a rectangle of cells, and back in its cell it stays the editor's", async ({
	page
}) => {
	const editor = await openTouch(page, TABLE);
	await fingerWord(page, editor, APPLE);
	const end = await pointAtRaw(page, APPLE.path, 5);
	const next = (await cellBox(page, 0, 1))!;
	await dragEndHandle(page, end, { x: next.x + next.width / 2, y: end.y });
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: { path: [1], offset: 0 }, focus: { path: [1], offset: 1 } });
	const corner = { x: next.x + next.width, y: next.y + next.height / 2 };
	await dragEndHandle(page, corner, await pointAtRaw(page, APPLE.path, 8));
	await expect
		.poll(() => selection(editor))
		.toEqual({ anchor: { path: APPLE.path, offset: 0 }, focus: { path: APPLE.path, offset: 8 } });
	expect(await editor.bridge.ownsRange()).toBe(true);
	expect(await nativeCollapsed(page)).toBe(true);
});

/** A finger on the end handle, moved so the point it drags travels from `from` to `to`. */
async function dragEndHandle(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number }
) {
	const box = (await page.locator('.selection-handle[data-handle="end"]').boundingBox())!;
	const x = Math.round(box.x + box.width / 2);
	const y = Math.round(box.y + box.height / 2);
	await fingerDrag(page, { x, y }, { x: x + to.x - from.x, y: y + to.y - from.y });
}
