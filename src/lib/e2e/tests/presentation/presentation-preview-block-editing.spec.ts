import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';

// preview-block is an EDITING mode: no edit path is gated, and the focus mark follows the
// caret through structural edits. Rendering lives in presentation-preview-block.spec.ts.
// Requirements: e2e/requirements/presentation/presentation-preview-block-editing.md.

const DOC = [
	'# Title',
	'',
	'alpha **beta** gamma',
	'',
	'second line here',
	'',
	'- [ ] a task'
].join('\n');

const togglePreview = (page: Page) => page.getByTestId('preview-block-toggle').click();
const toggleReading = (page: Page) => page.getByTestId('presentation-toggle').click();
const hostAt = (page: Page, path: number[]) =>
	page.locator(`[data-block-path='${JSON.stringify(path)}']`);

test.describe('preview-block — editing stays live', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await togglePreview(page);
	});

	test('typing commits and the document round-trips', async ({ page }) => {
		await ep.clickBlock(2);
		await page.keyboard.press('End');
		await ep.typeText(' more');
		await ep.bridge.waitForSourceContains('second line here more');
		expect(await page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('undo restores the prior source', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await ep.clickBlock(2);
		await page.keyboard.press('End');
		await ep.typeText('ZZZ');
		await ep.bridge.waitForSourceContains('ZZZ');
		await ep.undo();
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('task checkbox stays live — clicking it toggles', async ({ page }) => {
		await page.locator('.task-checkbox').first().click();
		await ep.bridge.waitForSourceContains('[x]');
	});

	test('split and merge move the focus mark with the caret', async ({ page }) => {
		const para = ep.getBlock(1).locator('.md-marker').first();
		await ep.clickBlock(1);
		await page.keyboard.press('End');
		await expect(para).toBeVisible();

		// Enter splits: a new empty block takes focus, the old block hides its markers.
		await page.keyboard.press('Enter');
		await ep.waitForRenderFlush();
		await expect(para).toBeHidden();
		await expect(hostAt(page, [2])).toHaveAttribute('data-focused', '');

		// Backspace merges back: focus lands on the merged block, its markers show.
		await page.keyboard.press('Backspace');
		await ep.waitForRenderFlush();
		await expect(hostAt(page, [1])).toHaveAttribute('data-focused', '');
		await expect(para).toBeVisible();
	});
});

test.describe('preview-block — selection, search, mode flips', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await togglePreview(page);
	});

	test('cross-block selection paints over a marker-hidden block', async ({ page }) => {
		await ep.focusBlockEnd(1);
		await page.keyboard.press('Shift+ArrowDown'); // extend into block 2
		await ep.waitForCrossBlock(true);
		// Block 2 stays unfocused (markers-hidden) yet the overlay paints across it.
		await expect(ep.getBlock(2).locator('.md-marker').first()).toBeHidden();
		await page.keyboard.press('ControlOrMeta+c');
		await ep.waitForClipboardWrite();
		expect((await ep.readClipboard()).length).toBeGreaterThan(0);
	});

	test('search highlights land on a marker-hidden block', async ({ page }) => {
		await ep.clickBlock(0);
		await page.keyboard.press('ControlOrMeta+f');
		await page.getByRole('textbox', { name: 'Find' }).waitFor({ state: 'visible' });
		await page.keyboard.type('beta'); // lives in the unfocused block 1
		await expect(page.locator('.match-overlay').first()).toBeVisible();
	});

	test('preview-block ↔ reading ↔ source is byte-stable', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await toggleReading(page); // preview-block → reading
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await toggleReading(page); // reading → source
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await togglePreview(page); // source → preview-block
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'preview-block');
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});

	test('flipping to reading clears the focus mark', async ({ page }) => {
		await ep.clickBlock(1);
		await expect(hostAt(page, [1])).toHaveAttribute('data-focused', '');
		await toggleReading(page); // reading blurs the active element
		await expect(page.locator('[data-focused]')).toHaveCount(0);
	});

	test('flipping the prop into preview-block marks the already-focused block', async ({ page }) => {
		// The header toggles blur the editor, so they clear the mark via focusout,
		// never through the mode reconcile. A consumer flipping the prop keeps focus —
		// this drives that path directly (revert the reconcile effect and it fails).
		await page.evaluate(() => (window as any).__test.setPresentationMode('source'));
		await ep.clickBlock(1);
		await expect(hostAt(page, [1])).not.toHaveAttribute('data-focused');
		await page.evaluate(() => (window as any).__test.setPresentationMode('preview-block'));
		await ep.waitForRenderFlush();
		await expect(hostAt(page, [1])).toHaveAttribute('data-focused', '');
		await expect(ep.getBlock(1).locator('.md-marker').first()).toBeVisible();
	});
});
