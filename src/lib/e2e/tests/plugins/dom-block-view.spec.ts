import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { extendKey } from '../../platform-keys';

/**
 * Blocks drawn by `defineBlockView` in a real browser (requirements/plugins/dom-block-view.md):
 * a memo leaf with a badge before its text, a badge block drawn whole, and a `:::dombox`
 * container, from `routes/test/plugins/dom-view`. The fixture's teardown fails any console error.
 */

const MEMO = 1;
const BADGE = 2;
const BOX = 3;

type Counts = Record<'mounts' | 'updates' | 'destroys', Record<string, number>>;

const viewLog = (page: Page): Promise<Counts> =>
	page.evaluate(() => structuredClone((window as any).__domViewLog) as Counts);

const source = (page: Page): Promise<string> =>
	page.evaluate(() => (window as any).__test.getSource() as string);

async function placeCaret(page: Page, path: number[], position: 'start' | 'end'): Promise<void> {
	const placed = await page.evaluate(
		({ path, position }) => (window as any).__test.placeCaret(path, position) as Promise<boolean>,
		{ path, position }
	);
	expect(placed).toBe(true);
}

test.describe('DOM block views', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('dom-view');
	});

	test('typing in the memo leaf writes its text, and undo takes it back', async ({ page }) => {
		await editor.focusBlockEnd(MEMO);
		await page.keyboard.type('!');
		await expect.poll(() => source(page)).toContain('@@ memo text!\n');
		expect(await source(page)).not.toContain('memo memo');

		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => source(page)).toContain('@@ memo text\n');
	});

	test('a badge block held whole is painted over exactly its element’s box', async ({ page }) => {
		await editor.focusBlockStart(0);
		await page.keyboard.press(extendKey('docEnd'));
		await editor.waitForCrossBlock(true);

		const overlay = page.locator(`[data-block-path='[${BADGE}]'] > .selection-overlay-middle`);
		await expect(overlay).toHaveCount(1);
		const painted = (await overlay.boundingBox())!;
		const drawn = (await page
			.locator(`[data-block-path='[${BADGE}]'] > .dom-badge`)
			.boundingBox())!;
		expect(drawn.height).toBeGreaterThan(0);
		for (const edge of ['x', 'y', 'width', 'height'] as const) {
			expect(Math.abs(painted[edge] - drawn[edge])).toBeLessThanOrEqual(1);
		}
	});

	test('typing in a dombox child updates the box view once per key', async ({ page }) => {
		const before = (await viewLog(page)).updates.dombox ?? 0;
		await placeCaret(page, [BOX, 1], 'end');
		await page.keyboard.type('abc');
		await expect.poll(() => source(page)).toContain('Insideabc\n');
		expect(((await viewLog(page)).updates.dombox ?? 0) - before).toBe(3);
	});

	test('a view scrolled out of the window is destroyed, and mounted again on the way back', async ({
		page
	}) => {
		const filler = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} lorem ipsum dolor`);
		await editor.loadContent(['[[dom-badge]]', ...filler].join('\n\n') + '\n');
		const badge = page.locator("[data-block-path='[0]'] > .dom-badge");
		await expect(badge).toHaveCount(1);
		const start = await viewLog(page);

		await editor.scrollEditorTo(1_000_000);
		await expect(badge).toHaveCount(0);
		expect((await viewLog(page)).destroys['dom-badge']).toBe(
			(start.destroys['dom-badge'] ?? 0) + 1
		);

		await editor.scrollEditorTo(0);
		await expect(badge).toHaveCount(1);
		expect((await viewLog(page)).mounts['dom-badge']).toBe(start.mounts['dom-badge'] + 1);
	});

	test('ArrowRight out of the badge ends the column the ArrowDown into it kept', async ({
		page
	}) => {
		await editor.loadContent(
			'abcdefghijklmnop\n\n[[dom-badge]]\n\n0123456789abcdef\n\nzyxwvutsrq\n'
		);
		const caret = async () => (await editor.bridge.getSelectionPaths())?.focus ?? null;
		await editor.focusBlock(0, 10);
		await page.keyboard.press('ArrowDown');
		await expect(page.locator('.dom-badge')).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect.poll(caret).toEqual({ path: [2], offset: 0 });
		await page.keyboard.press('ArrowDown');
		await expect.poll(caret).toEqual({ path: [3], offset: 0 });
	});

	test('a dombox’s own children window inside its box, and mount as they scroll in', async ({
		page
	}) => {
		const children = Array.from({ length: 400 }, (_, i) => `Child ${i} lorem ipsum dolor`);
		await editor.loadContent([':::dombox Long', children.join('\n\n'), ':::', ''].join('\n'));
		const mounted = (path: string) => page.locator(`.dombox [data-block-path='${path}']`);
		const childHosts = page.locator(".dombox > .block-list [data-block-path^='[0,']");
		await expect(mounted('[0,1]')).toHaveCount(1);
		expect(await childHosts.count()).toBeLessThan(400);
		expect(await page.locator('.dombox .vr-spacer').count()).toBeGreaterThan(0);

		await editor.scrollEditorTo(1_000_000);
		await expect(mounted('[0,400]')).toHaveCount(1);
		await expect(mounted('[0,1]')).toHaveCount(0);
	});
});
