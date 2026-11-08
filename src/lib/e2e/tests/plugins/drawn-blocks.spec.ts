import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * A box a plugin draws with an editing surface of its own (requirements/plugins/drawn-blocks.md):
 * the `%%field` block from `routes/test/plugins/drawn`, between a line above and a line below.
 */

const ABOVE = 0;
const FIELD = 1;
const BELOW = 2;
// The field's first line, `first line here`, and the break after it.
const SECOND_LINE_START = 16;

interface FieldCaret {
	offset: number;
	x: number;
}

const fieldCaret = (page: Page): Promise<FieldCaret | null> =>
	page.evaluate(() => (window as any).__drawnField?.() ?? null);

const caretX = async (page: Page): Promise<number> => {
	const rect = await page.evaluate(() => {
		const r = (window as any).__test.caretRect() as DOMRect | null;
		return r && { left: r.left };
	});
	expect(rect).not.toBeNull();
	return rect!.left;
};

const caretPath = (page: Page): Promise<number[] | null> =>
	page.evaluate(() => (window as any).__test.getSelection()?.focus.path ?? null);

const caretOffset = (page: Page): Promise<number | null> =>
	page.evaluate(() => (window as any).__test.getSelection()?.focus.offset ?? null);

async function placeCaret(page: Page, path: number[], position: 'start' | 'end' | number) {
	const placed = await page.evaluate(
		({ path, position }) => (window as any).__test.placeCaret(path, position) as Promise<boolean>,
		{ path, position }
	);
	expect(placed).toBe(true);
}

// One field character is 16px monospace wide, about 9.6px; a column rounds to the nearest one.
const SAME_COLUMN = 6;

test.describe('a drawn box with its own editing surface', () => {
	test.beforeEach(async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('drawn');
	});

	test('ArrowDown from the line above enters the first line at the column', async ({ page }) => {
		await placeCaret(page, [ABOVE], 10);
		const from = await caretX(page);
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		const at = (await fieldCaret(page))!;
		expect(at.offset).toBeLessThan(SECOND_LINE_START);
		expect(Math.abs(at.x - from)).toBeLessThan(SAME_COLUMN);
	});

	test('ArrowUp from the line below enters the last line at the column', async ({ page }) => {
		await placeCaret(page, [BELOW], 10);
		const from = await caretX(page);
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		const at = (await fieldCaret(page))!;
		expect(at.offset).toBeGreaterThanOrEqual(SECOND_LINE_START);
		expect(Math.abs(at.x - from)).toBeLessThan(SAME_COLUMN);
	});

	test('ArrowUp on the first line leaves into the line above at the column', async ({ page }) => {
		await placeCaret(page, [ABOVE], 4);
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
		const inField = (await fieldCaret(page))!;
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => caretPath(page)).toEqual([ABOVE]);
		expect(Math.abs((await caretX(page)) - inField.x)).toBeLessThan(SAME_COLUMN);
	});

	test('ArrowDown on the last line leaves into the line below at the column', async ({ page }) => {
		await placeCaret(page, [BELOW], 4);
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => fieldCaret(page)).not.toBeNull();
		for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
		const inField = (await fieldCaret(page))!;
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => caretPath(page)).toEqual([BELOW]);
		expect(Math.abs((await caretX(page)) - inField.x)).toBeLessThan(SAME_COLUMN);
	});

	test('ArrowRight and ArrowLeft cross the start edge both ways', async ({ page }) => {
		await placeCaret(page, [ABOVE], 'end');
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: 0 });
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => caretPath(page)).toEqual([ABOVE]);
		expect(await caretOffset(page)).toBe('above the field, a line'.length);
	});

	test('ArrowLeft and ArrowRight cross the end edge both ways', async ({ page }) => {
		await placeCaret(page, [BELOW], 'start');
		await page.keyboard.press('ArrowLeft');
		const end = 'first line here\nsecond line here'.length;
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: end });
		await page.keyboard.press('ArrowRight');
		await expect.poll(() => caretPath(page)).toEqual([BELOW]);
		expect(await caretOffset(page)).toBe(0);
	});

	test('undo puts the caret back at the offset the field gave', async ({ page }) => {
		await placeCaret(page, [ABOVE], 'end');
		await page.keyboard.press('ArrowRight');
		for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: 7 });
		await page.keyboard.press('Alt+ArrowDown');
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSource() as string))
			.toMatch(/below the field, a line\n\n%%field\n$/);
		await page.keyboard.press('ControlOrMeta+z');
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSource() as string))
			.toMatch(/^above the field, a line\n\n%%field\n/);
		await expect.poll(() => fieldCaret(page)).toMatchObject({ offset: 7 });
		expect(await caretPath(page)).toEqual([FIELD]);
	});
});
