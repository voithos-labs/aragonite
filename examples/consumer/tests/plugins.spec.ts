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

test('toc lists the document headings from the document prop', async ({ page }) => {
	// The toc nav is read straight off BlockComponentProps.document. highlight-occurrences
	// installs alongside it: a page error from either trips the beforeEach no-error gate.
	await expect(page.locator('.toc-block-item', { hasText: 'Consumer plugins' })).toBeVisible();
	expect(await getSource(page)).toContain('[[toc]]');
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
	// The stylesheet rides `@voithos-labs/aragonite/plugins/latex/renderer` as a bare side-effect import.
	// Without it KaTeX's `.katex-mathml` a11y half lays out at glyph size beside the render.
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
	// The consumer has no mermaid devDependency and wires no renderer, so the packaged block
	// takes its no-engine branch: the core/renderer split installs without pulling the engine.
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

// The two below assert resolution, not emoji/footnote behavior (the in-repo plugin e2e suites
// own that): the packaged subpath installs and paints from outside the repo.

test('emoji paints the glyph from the packaged subpath while the shortcode stays in the source', async ({
	page
}) => {
	await expect(page.locator('.md-emoji-widget')).toHaveText('✨');
	const src = await getSource(page);
	expect(src).toContain('Emoji :sparkles: inline');
	expect(src).toContain(':::mystery'); // the `:` rung did not eat the directive fence
});

test('footnote reference derives its number and its definition round-trips', async ({ page }) => {
	// The number is derived from first-reference order, never stored: the `1` is the packaged
	// numbering seam running in the consumer, not a byte from the seed.
	await expect(page.locator('sup.footnote-ref')).toHaveText('1');
	await expect(page.locator('.footnote-def')).toBeVisible();
	const src = await getSource(page);
	expect(src).toContain('Footnote reference[^1] in prose');
	expect(src).toContain('[^1]: Footnote definition body');
	expect(src).toContain('[[toc]]'); // the `[` rung did not eat the toc leaf
});
