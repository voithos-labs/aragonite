import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { pointAtRaw } from '../text-runs';

// A right-click on a range the editor paints keeps it for the clipboard rows; one anywhere else
// ends it. Requirements: `requirements/context-menu-range.md`.

const BETWEEN = '- item\n\n> quote\n\n---\n\n| a | b |\n| - | - |\n| c | d |\n';
// `first` [0], the four blocks [1]-[4], `last` [5], the same four again [6]-[9].
const DOC = `first\n\n${BETWEEN}\nlast\n\n${BETWEEN}`;
const INSIDE = 1;
const OUTSIDE = 6;

interface Point {
	x: number;
	y: number;
}

/** The four places a range's paint covers that hold no text of their own, found from the index of
 *  the list that starts each group: a list's marker, a quote's rail, a rule, a cell's padding. */
const TARGETS: { name: string; at: (page: Page, first: number) => Promise<Point> }[] = [
	{
		name: "a list item's marker",
		at: (page, first) => centerOf(page, `[data-block-path="[${first}]"] .list-item-marker`)
	},
	{
		name: "a quote's rail",
		at: async (page, first) => {
			const quote = await box(page, `[data-block-path="[${first + 1}]"] .blockquote-block`);
			return { x: quote.x + 4, y: quote.y + quote.height / 2 };
		}
	},
	{ name: 'a rule', at: (page, first) => centerOf(page, `[data-block-path="[${first + 2}]"] hr`) },
	{
		name: "a cell's padding",
		at: async (page, first) => {
			const cell = await box(page, `[data-block-path="[${first + 3}]"] .table-cell`);
			return { x: cell.x + 2, y: cell.y + cell.height / 2 };
		}
	}
];

async function box(page: Page, selector: string) {
	const found = await page.locator(selector).first().boundingBox();
	if (!found) throw new Error(`no box for ${selector}`);
	return found;
}

async function centerOf(page: Page, selector: string): Promise<Point> {
	const { x, y, width, height } = await box(page, selector);
	return { x: x + width / 2, y: y + height / 2 };
}

const menuItem = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });

test.describe('the right-click menu over a range the editor holds', () => {
	let editor: EditorPage;

	async function selectAcross(): Promise<void> {
		await editor.focusBlockAtPath([0], 1);
		await editor.shiftClickBlock([5], 2);
		await expect.poll(() => editor.bridge.ownsRange()).toBe(true);
	}

	async function rightClick({ x, y }: Point): Promise<void> {
		await editor.page.mouse.click(x, y, { button: 'right' });
	}

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
		await editor.seedClipboard('');
	});

	for (const target of TARGETS) {
		test(`a right-click on ${target.name} inside the range keeps it for Cut and Copy`, async ({
			page
		}) => {
			await selectAcross();
			await rightClick(await target.at(page, INSIDE));
			await expect(menuItem(page, 'Cut')).toBeEnabled();
			await expect(menuItem(page, 'Copy')).toBeEnabled();
			await expect(menuItem(page, 'Insert block')).toHaveCount(0);
			expect(await editor.bridge.ownsRange()).toBe(true);
		});

		test(`a right-click on ${target.name} below the range ends it`, async ({ page }) => {
			await selectAcross();
			await rightClick(await target.at(page, OUTSIDE));
			await expect(page.getByRole('menuitem').first()).toBeVisible();
			expect(await editor.bridge.ownsRange()).toBe(false);
		});
	}

	test('a right-click on the first line before the range ends it and opens the prose menu', async ({
		page
	}) => {
		await selectAcross();
		await rightClick(await pointAtRaw(page, [0], 0));
		await expect(menuItem(page, 'Insert block')).toBeVisible();
		await expect(menuItem(page, 'Cut')).toBeDisabled();
		expect(await editor.bridge.ownsRange()).toBe(false);
	});

	test("the menu's Copy writes what Ctrl+C writes and leaves the document", async ({ page }) => {
		await selectAcross();
		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();
		const chord = await editor.readClipboard();
		await editor.seedClipboard('');
		await rightClick(await pointAtRaw(page, [0], 3));
		await menuItem(page, 'Copy').click();
		await expect.poll(() => editor.readClipboard()).toBe(chord);
		expect(await editor.bridge.getSource()).toBe(DOC);
	});

	test('a right-click on the open menu keeps the range for the row picked next', async ({
		page
	}) => {
		await selectAcross();
		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();
		const chord = await editor.readClipboard();
		await editor.seedClipboard('');
		// On the end line, so the menu hangs over the blocks below the range, where nothing is painted.
		await rightClick(await pointAtRaw(page, [5], 1));
		await rightClick(await centerOf(page, '.md-menu [role="menuitem"]:has-text("Paste")'));
		expect(await editor.bridge.ownsRange()).toBe(true);
		await menuItem(page, 'Copy').click();
		await expect.poll(() => editor.readClipboard()).toBe(chord);
	});

	test("the cell menu's Cut over the range ends as Ctrl+X does", async ({ page }) => {
		await selectAcross();
		await page.keyboard.press('ControlOrMeta+x');
		await editor.waitForClipboardWrite();
		const chord = {
			source: await editor.bridge.getSource(),
			clipboard: await editor.readClipboard()
		};
		await editor.undo();
		await editor.bridge.waitForSourceEquals(DOC);
		await editor.seedClipboard('');

		await selectAcross();
		await rightClick(await TARGETS[3].at(page, INSIDE));
		await menuItem(page, 'Cut').click();
		await expect
			.poll(async () => ({
				source: await editor.bridge.getSource(),
				clipboard: await editor.readClipboard()
			}))
			.toEqual(chord);
	});
});

test("the cell menu's Paste of copied cells over the range replaces it, as Ctrl+V does", async ({
	page
}) => {
	const editor = new EditorPage(page);
	await editor.goto();
	const doc = 'one\n\n| a | b |\n| - | - |\n| c | d |\n\nafter\n';
	await editor.loadContent(doc);
	await editor.seedClipboard('X\tY');
	const selectAcross = async () => {
		await editor.focusBlockAtPath([0], 1);
		await editor.shiftClickBlock([2], 2);
		await expect.poll(() => editor.bridge.ownsRange()).toBe(true);
	};
	await selectAcross();
	await editor.paste();
	await expect.poll(() => editor.bridge.getSource()).not.toBe(doc);
	const chord = await editor.bridge.getSource();
	await editor.undo();
	await editor.bridge.waitForSourceEquals(doc);

	await selectAcross();
	const cell = await box(page, '[data-block-path="[1]"] .table-cell');
	await page.mouse.click(cell.x + 2, cell.y + cell.height / 2, { button: 'right' });
	await menuItem(page, 'Paste').click();
	await editor.bridge.waitForSourceEquals(chord);
});

test("the menu's Paste over a rule held whole replaces it, as Ctrl+V does", async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('above\n\n---\n\nbelow\n');
	await editor.seedClipboard('pasted');
	const rule = await box(page, '.thematic-break-block');
	const y = rule.y + rule.height / 2;
	await page.mouse.move(rule.x + 8, y);
	await page.mouse.down();
	await page.mouse.move(rule.x + rule.width - 8, y, { steps: 8 });
	await page.mouse.up();
	await editor.waitForCrossBlock(true);

	await page.mouse.click(rule.x + rule.width / 2, y, { button: 'right' });
	await menuItem(page, 'Paste').click();
	await editor.bridge.waitForSourceEquals('above\n\npasted\n\nbelow\n');
});
