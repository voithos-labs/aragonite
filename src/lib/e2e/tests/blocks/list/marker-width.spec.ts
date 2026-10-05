import { test, expect } from '../../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// Requirements: `e2e/requirements/blocks/list/marker-width.md`.

/** The metadata of the node at `path` in the live tree, walked through children. */
function metadataAt(page: Page, path: number[]): Promise<Record<string, unknown> | undefined> {
	return page.evaluate((at) => {
		let node = (window as any).__test.getDocument();
		for (const i of at) node = node?.children?.[i];
		return node?.metadata;
	}, path);
}

test.describe('a space left at an item’s content start', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace after the first word widens the bullet, as a reload reads it', async ({
		page
	}) => {
		await editor.loadContent('- a b\n');
		await editor.focusBlockAtPath([0, 0, 0], 1);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('-  b\n');

		expect(await editor.parseConverged()).toBe(true);
		expect(await metadataAt(page, [0, 0])).toMatchObject({ marker: '-  ' });

		await page.keyboard.type('z');
		await editor.bridge.waitForSourceEquals('-  zb\n');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('the same Backspace in a to-do widens its checkbox', async ({ page }) => {
		await editor.loadContent('- [ ] a b\n');
		await editor.focusBlockAtPath([0, 0, 0], 1);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('- [ ]  b\n');

		expect(await editor.parseConverged()).toBe(true);
		expect(await metadataAt(page, [0, 0])).toMatchObject({ taskMarker: '[ ]  ' });
	});

	test('a line below, indented to the old marker, stays in the item', async ({ page }) => {
		await editor.loadContent('- a b\n  c\n');
		await editor.focusBlockAtPath([0, 0, 0], 1);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('-  b\n  c\n');

		expect(await editor.parseConverged()).toBe(true);
		expect(await metadataAt(page, [0, 0])).toMatchObject({ marker: '-  ' });
	});

	test('a nested list the wider marker no longer holds becomes the next item', async ({ page }) => {
		await editor.loadContent('- a b\n  - sub\n');
		await editor.focusBlockAtPath([0, 0, 0], 1);

		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('-  b\n  - sub\n');

		expect(await editor.parseConverged()).toBe(true);
		const items = await page.evaluate(
			() => (window as any).__test.getDocument().children[0].children.length
		);
		expect(items).toBe(2);
	});

	test('Enter after the first word gives the new item the wider bullet', async ({ page }) => {
		await editor.loadContent('- a b\n');
		await editor.focusBlockAtPath([0, 0, 0], 1);

		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('- a\n-  b\n');

		expect(await editor.parseConverged()).toBe(true);
		expect(await metadataAt(page, [0, 1])).toMatchObject({ marker: '-  ' });
	});

	test('undo gives back the loaded bytes and their reading', async ({ page }) => {
		await editor.loadContent('- a b\n\n  c\n');
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('-  b\n\n  c\n');
		expect(await editor.parseConverged()).toBe(true);
		await editor.waitForUndoBatchFlush();

		await editor.undo();

		await editor.bridge.waitForSourceEquals('- a b\n\n  c\n');
		expect(await editor.parseConverged()).toBe(true);
		expect(await metadataAt(page, [0, 0])).toMatchObject({ marker: '- ' });
	});
});
