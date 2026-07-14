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

test('math paints once — katex.min.css rides the packaged renderer adapter', async ({ page }) => {
	// The stylesheet's bare side-effect import rides `aragonite/plugins/latex/renderer`
	// (sideEffects-listed so a bundler keeps it). Without it KaTeX's `.katex-mathml`
	// a11y half lays out at glyph size beside the render, echoing the TeX as plain text.
	const widget = page.locator('.math-inline-widget').first();
	await expect(widget.locator('.katex-html')).toHaveCount(1);
	const mathmlBox = await widget.locator('.katex-mathml').boundingBox();
	expect(mathmlBox).not.toBeNull();
	expect(mathmlBox!.width).toBeLessThanOrEqual(2);
	expect(mathmlBox!.height).toBeLessThanOrEqual(2);
});

test('mermaid installs from the package and renders statically without an engine', async ({
	page
}) => {
	// The consumer has no mermaid devDependency and wires no renderer, so the packaged
	// block takes its no-engine branch: the fence code shown verbatim plus a note. This
	// is the whole point of the core/renderer split — the plugin resolves and installs
	// without pulling the engine.
	const block = page.locator('.mermaid-block');
	await expect(block).toBeVisible();
	await expect(block.locator('.mermaid-note')).toContainText('Mermaid renderer not configured');
	await expect(block.locator('.mermaid-static')).toContainText('graph TD');
	expect(await getSource(page)).toContain('```mermaid');
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
