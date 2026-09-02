import { test, expect } from '../../fixtures';
import { waitForEditorHydrated } from '../../page-probes';

// The `/` showcase mounts <Editor> with all nine bundled plugins installed the consumer way
// (subpath imports, injected latex/mermaid engines) and exposes no `window.__test` bridge, so this
// smoke asserts through rendered DOM only. The shared fixture also fails on any `[invariant:…]`
// console fire, so a green run additionally proves the showcase document loads clean under every
// plugin. Presence only — editing behavior belongs to the machine-facing batteries.

test.describe('/ showcase route', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// The route SSRs, and the plugin surfaces below only exist post-hydration.
		await waitForEditorHydrated(page);
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
		// Two block displays render — the `$$…$$` block and the ```math fence, the
		// distinct kinds sharing one component (block math is followed by the fence).
		await expect.poll(() => page.locator('.math-block-render').count()).toBeGreaterThan(1);
		// Mermaid renders async (the adapter dynamic-imports the engine); settle on
		// the always-present wrapper, not the engine's SVG, to stay timing-robust.
		await expect(page.locator('.mermaid-block').first()).toBeVisible();
	});

	test('native GitHub alert renders as its own styled callout', async ({ page }) => {
		await expect(page.locator(".admonition[data-alert-source='github']").first()).toBeVisible();
	});

	test('emoji shortcodes render as glyph widgets in prose, a heading, and a table cell', async ({
		page
	}) => {
		// Prose plus the two ambient contexts: the `:` rung runs the same in a heading and a table
		// cell as in a paragraph.
		await expect.poll(() => page.locator('.md-emoji-widget').count()).toBeGreaterThan(1);
		await expect(
			page.locator('[data-block-kind="heading"] .md-emoji-widget').first()
		).toBeVisible();
		await expect(page.locator('[data-block-kind="table"] .md-emoji-widget').first()).toBeVisible();
	});

	test('toc lists the document headings, indented by level', async ({ page }) => {
		await expect(page.locator('.toc-block-item').first()).toBeVisible();
		await expect.poll(() => page.locator('.toc-block-item').count()).toBeGreaterThan(1);
		// The showcase nests headings to depth 4, so the default outline (maxDepth 6)
		// demonstrates real indentation instead of one flat level.
		await expect(page.locator('.toc-block-item.toc-block-level-2').first()).toBeVisible();
		await expect(page.locator('.toc-block-item.toc-block-level-4').first()).toBeVisible();
	});

	test('footnotes render a reference widget and an editable definition', async ({ page }) => {
		// The reference renders as a superscript number (first-reference order → "1"), and the
		// definition renders as its own editable block — both plugin tiers on one document.
		await expect(page.locator('.footnote-ref').first()).toHaveText('1');
		await expect(page.locator('.footnote-def').first()).toBeVisible();
	});

	test('built-in kinds render alongside the plugins', async ({ page }) => {
		await expect(page.locator('[data-block-kind="table"]').first()).toBeVisible();
		await expect(page.locator('[data-block-kind="fencedCode"]').first()).toBeVisible();
	});
});
