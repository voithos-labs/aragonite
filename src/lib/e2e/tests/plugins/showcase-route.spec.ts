import { test, expect } from '../../fixtures';

// The `/` showcase mounts <Editor> with all six bundled plugins installed the
// consumer way (subpath imports, injected latex/mermaid engines) and exposes no
// `window.__test` bridge — so this smoke asserts through rendered DOM only. The
// shared fixture also fails on any `[invariant:…]` console fire, so a green run
// additionally proves the showcase document loads clean under every plugin.
// Editing behavior belongs to the machine-facing batteries; this is presence only.

test.describe('/ showcase route', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// The document parsed and the block list rendered.
		await expect(page.locator('.block-host').first()).toBeVisible();
	});

	test('renders the showcase document as a block list', async ({ page }) => {
		// A floor well below the mounted block count, robust to a shifting window.
		await expect.poll(() => page.locator('.block-host').count()).toBeGreaterThan(10);
	});

	test('bundled container plugins render their chrome', async ({ page }) => {
		await expect(page.locator('.admonition[data-kind]').first()).toBeVisible();
		await expect(page.locator('.details-block').first()).toBeVisible();
	});

	test('math and mermaid islands render', async ({ page }) => {
		// KaTeX output proves the injected latex engine ran on a math widget.
		await expect(page.locator('.katex').first()).toBeVisible();
		// Mermaid renders async (the adapter dynamic-imports the engine); settle on
		// the always-present wrapper, not the engine's SVG, to stay timing-robust.
		await expect(page.locator('.mermaid-block').first()).toBeVisible();
	});

	test('toc lists the document headings', async ({ page }) => {
		await expect(page.locator('.toc-block-item').first()).toBeVisible();
		await expect.poll(() => page.locator('.toc-block-item').count()).toBeGreaterThan(1);
	});

	test('built-in kinds render alongside the plugins', async ({ page }) => {
		await expect(page.locator('[data-block-kind="table"]').first()).toBeVisible();
		await expect(page.locator('[data-block-kind="fencedCode"]').first()).toBeVisible();
	});
});
