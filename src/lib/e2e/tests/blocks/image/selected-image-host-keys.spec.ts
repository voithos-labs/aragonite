import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { waitForFirstImageLoaded } from './helpers';

// A selected image keeps every key the browser could apply to the DOM under it, and lets a key
// with no editing default (a function key, the context-menu key) through to the host.
// Requirements: `e2e/requirements/blocks/image/selected-image-host-keys.md`.

const DOC = 'Before\n\n![alt](/test-fixtures/sample.png)\n\nAfter\n';
const overlay = (page: Page) => page.locator('[data-image-overlay]');

async function selectImage(page: Page): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto('?presentationMode=live');
	await editor.loadContent(DOC);
	await waitForFirstImageLoaded(page);
	await page.locator('[data-image-widget]').first().click();
	await expect(overlay(page)).toBeVisible();
	return editor;
}

/** Presses `key` and reports whether its keydown was prevented once every handler had run. */
async function pressAndReadPrevented(page: Page, key: string): Promise<boolean> {
	await page.evaluate(() => {
		const w = window as unknown as { lastKeydownPrevented?: boolean };
		window.addEventListener('keydown', (e) => (w.lastKeydownPrevented = e.defaultPrevented), {
			once: true
		});
	});
	await page.keyboard.press(key);
	return page.evaluate(
		() => (window as unknown as { lastKeydownPrevented?: boolean }).lastKeydownPrevented ?? true
	);
}

test.describe('a selected image and the host’s keys', () => {
	for (const key of ['F5', 'ContextMenu']) {
		test(`${key} reaches the host and the image stays selected`, async ({ page }) => {
			const editor = await selectImage(page);
			expect(await pressAndReadPrevented(page, key)).toBe(false);
			await expect(overlay(page)).toBeVisible();
			expect(await editor.bridge.getSource()).toBe(DOC);
		});
	}

	test('a letter still replaces the image', async ({ page }) => {
		const editor = await selectImage(page);
		expect(await pressAndReadPrevented(page, 'x')).toBe(true);
		await editor.bridge.waitForSourceEquals('Before\n\nx\n\nAfter\n');
	});

	test('Backspace still removes the image', async ({ page }) => {
		const editor = await selectImage(page);
		expect(await pressAndReadPrevented(page, 'Backspace')).toBe(true);
		await editor.bridge.waitForSourceEquals('Before\n\n\nAfter\n');
	});
});
