import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';

// preview-inline is an EDITING mode: a revealed construct is ordinary source
// text, so typing commits per keystroke, undo restores, and the reveal state
// survives every rebuild. Rendering/reveal scenarios live in
// presentation-preview-inline.spec.ts.
// Requirements: e2e/requirements/presentation/presentation-preview-inline-editing.md.

const DOC = ['# Title', '', 'alpha **beta** gamma'].join('\n');

const togglePreviewInline = (page: Page) => page.getByTestId('preview-inline-toggle').click();

// Walks the caret to a deterministic raw offset with real key presses — a click
// can't target hidden marker bytes.
async function caretToOffset(ep: EditorPage, page: Page, offset: number): Promise<void> {
	await page.keyboard.press('Home');
	for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
	await ep.waitForRenderFlush();
	expect((await ep.bridge.getSelectionPaths())?.focus.offset).toBe(offset);
}

test.describe('preview-inline — editing stays live', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await togglePreviewInline(page);
	});

	test('typing inside a revealed construct commits per keystroke and round-trips', async ({
		page
	}) => {
		const markers = ep.getBlock(1).locator('[data-construct-start]');
		await ep.clickBlock(1);
		// "alpha **beta** gamma" — raw 10 is "be|ta", inside strong [6,14).
		await caretToOffset(ep, page, 10);
		await expect(markers.first()).toBeVisible();

		// One key, one committed source update — no fold-to-commit ceremony.
		await page.keyboard.press('X');
		await ep.bridge.waitForSourceContains('**beXta**');
		// The reveal survived the rebuild (re-applied before paint, no fold flash).
		await expect(markers.first()).toBeVisible();
		await expect(markers.nth(1)).toBeVisible();
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('undo restores the prior source', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await ep.clickBlock(1);
		await caretToOffset(ep, page, 10);
		await page.keyboard.type('ZZ');
		await ep.bridge.waitForSourceContains('**beZZta**');
		await ep.undo();
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('typing in revealed marker text edits those bytes honestly', async ({ page }) => {
		await ep.clickBlock(1);
		// Raw 13 sits between the closing `*`s — reachable only because the reveal
		// made the marker text visible, steppable, and editable.
		await caretToOffset(ep, page, 13);
		await page.keyboard.press('x');
		await ep.bridge.waitForSourceContains('alpha **beta*x* gamma');
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('deleting the closing marker dissolves the construct with no stale reveal', async ({
		page
	}) => {
		await ep.clickBlock(1);
		await caretToOffset(ep, page, 14); // the construct's trailing edge (inclusive)
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceContains('alpha **beta gamma');
		// The unmatched `**` reparses to plain text: no construct spans remain, and
		// no orphaned reveal class either.
		await expect(ep.getBlock(1).locator('[data-construct-start]')).toHaveCount(0);
		await expect(ep.getBlock(1).locator('.md-construct-reveal')).toHaveCount(0);
	});

	test('focus-preserving mode flips re-evaluate the reveal; bytes stay put', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await ep.clickBlock(1);
		await caretToOffset(ep, page, 10);
		await expect(ep.getBlock(1).locator('[data-construct-start]').first()).toBeVisible();

		// preview-block: the whole focused block reveals (no stamps, focus-keyed CSS).
		await page.evaluate(() => (window as any).__test.setPresentationMode('preview-block'));
		await ep.waitForRenderFlush();
		await expect(ep.getBlock(1).locator('.md-marker').first()).toBeVisible();

		// Back to preview-inline: only the caret chain shows again.
		await page.evaluate(() => (window as any).__test.setPresentationMode('preview-inline'));
		await ep.waitForRenderFlush();
		await expect(ep.getBlock(1).locator('[data-construct-start]').first()).toBeVisible();
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeHidden();

		await page.evaluate(() => (window as any).__test.setPresentationMode('source'));
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeVisible();
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});
});
