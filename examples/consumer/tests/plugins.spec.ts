import { test, expect, type Page } from '@playwright/test';

const getSource = (page: Page) =>
	page.evaluate(() => (window as { __consumer?: { getSource(): string } }).__consumer!.getSource());

test.beforeEach(async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto('/plugins');
	await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
	expect(errors).toEqual([]);
});

test('callout mounts as a container and round-trips an edit', async ({ page }) => {
	await expect(page.locator('.callout-block')).toBeVisible();
	const body = page.locator('[contenteditable="true"]', { hasText: 'Callout body' });
	await body.click();
	await body.press('End');
	await page.keyboard.type('!');
	await expect.poll(() => getSource(page)).toContain('Callout body!');
	expect(await getSource(page)).toContain(':::note Title');
});

test('details renders its summary chrome and body', async ({ page }) => {
	await expect(page.locator('.details-block .details-toggle')).toBeVisible();
	await expect(page.getByText('Summary')).toBeVisible();
	await expect(page.getByText('Details body')).toBeVisible();
	expect(await getSource(page)).toContain('<details open>');
});

test('inline math renders as a widget, not literal dollars', async ({ page }) => {
	// The $x^2$ span is an atomic widget: its raw bytes ride data attributes, not textContent.
	const widget = page.locator('[data-inline-widget]').first();
	await expect(widget).toBeVisible();
	expect(await getSource(page)).toContain('$x^2$');
});

test('block math renders KaTeX and reveals its source on click (editable-leaf tier)', async ({
	page
}) => {
	const render = page.locator('.math-block-render');
	await expect(render).toBeVisible();
	await expect(render.locator('.katex')).toBeVisible();

	await render.click();
	const source = page.locator('.math-block-source');
	await expect(source).toBeVisible();
	await expect(source).toHaveText('$$e^{i\\pi} + 1 = 0$$');
	expect(await getSource(page)).toContain('$$e^{i\\pi} + 1 = 0$$');
});

test('admonition renders its title chrome and round-trips its source', async ({ page }) => {
	await expect(page.locator('.admonition[data-kind="tip"]')).toBeVisible();
	await expect(page.getByText('Consumer tip')).toBeVisible();
	expect(await getSource(page)).toContain(':::tip Consumer tip');
});

test('unregistered directive round-trips byte-for-byte through the generic fallback', async ({
	page
}) => {
	const src = await getSource(page);
	expect(src).toContain(':::mystery\nUnregistered directive body\n:::');
});
