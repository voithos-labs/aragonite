import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Fenced code highlighted by the highlight package inside the framework app. Requirements:
// requirements/highlight.md.

const keyword = (page: Page, text: string) =>
	page.locator('.editor .code-tok-keyword', { hasText: text });

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.editor')).toBeVisible();
	await page.getByTestId('load-code').click();
});

test('a js fence paints its keyword', async ({ page }) => {
	await expect(keyword(page, 'const')).toHaveText('const');
});

test('a fence in a language fetched on demand paints once its grammar lands', async ({ page }) => {
	await expect(keyword(page, 'fn')).toHaveText('fn');
});
