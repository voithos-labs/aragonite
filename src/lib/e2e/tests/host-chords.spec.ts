import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { gotoReady } from '../goto-ready';
import { edgeKey, isMacOS, WORD_MODIFIER } from '../platform-keys';

// A host's capture-phase shortcuts around the editor, asking `claimsChord`.
// Requirements: e2e/requirements/host-chords.md.

interface HostChords {
	ran(): string[];
	source(): string;
	caret(): number | null;
}

const read = <K extends keyof HostChords>(page: Page, key: K) =>
	page.evaluate((k) => (window as unknown as { __hostChords: HostChords }).__hostChords[k](), key);

const PARAGRAPH = 'A paragraph to read.';

test.describe('a host shortcut runs only where the editor leaves the key', () => {
	test.beforeEach(async ({ page }) => {
		await gotoReady(page, '/test/host-chords');
	});

	test('Alt+← in a paragraph runs the host action', async ({ page }) => {
		test.skip(isMacOS, 'Option+← is the word key on a Mac');
		const before = await read(page, 'source');
		await page.getByText(PARAGRAPH).click();
		await page.keyboard.press('Alt+ArrowLeft');
		expect(await read(page, 'ran')).toEqual(['Alt+ArrowLeft']);
		expect(await read(page, 'source')).toBe(before);
	});

	test('Alt+← in a table cell moves the column and leaves the host alone', async ({ page }) => {
		test.skip(isMacOS, 'the column chords are Windows and Linux only');
		await page.locator('[role="cell"]', { hasText: '2' }).click();
		await page.keyboard.press('Alt+ArrowLeft');
		await expect.poll(() => read(page, 'source')).toContain('| B | A | C |');
		expect(await read(page, 'ran')).toEqual([]);
	});

	test('the word key in a paragraph moves the caret and leaves the host alone', async ({
		page
	}) => {
		await page.getByText(PARAGRAPH).click();
		await page.keyboard.press(edgeKey('lineStart'));
		await page.keyboard.press(`${WORD_MODIFIER}+ArrowRight`);
		await expect.poll(() => read(page, 'caret')).toBeGreaterThan(0);
		expect(await read(page, 'ran')).toEqual([]);
	});
});
