import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

/**
 * Probe round-trip fidelity: copy a selection, paste it somewhere,
 * verify content survives. Copy and paste sit at opposite ends of the
 * clipboard pipeline; a bug in either surfaces as a round-trip mismatch.
 */
test.describe('clipboard exploration: cross-container round-trip', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('copy from blockquote inner paragraph, paste into top-level paragraph', async () => {
		await editor.loadContent('> inside bq\n\ntarget para\n');

		// Select "inside bq" entirely in the blockquote's inner paragraph.
		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([0, 0], 'inside bq'.length);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		// Move focus to top-level target paragraph and paste at its end.
		await editor.focusBlockAtPath([1], 'target para'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// The paragraph should now contain "target parainside bq" (concatenated).
		expect(src).toContain('target parainside bq');
		// Blockquote should be intact.
		expect(src).toMatch(/> inside bq/);
	});

	test('copy a paragraph, paste into blockquote inner paragraph (structural preserves blockquote marker)', async () => {
		await editor.loadContent('outer para\n\n> target inside bq\n');

		// Select "outer para" fully.
		await editor.focusBlockAtPath([0], 0);
		await editor.shiftClickBlock([0], 'outer para'.length);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		// Paste into the blockquote inner paragraph.
		await editor.focusBlockAtPath([1, 0], 'target inside bq'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// The blockquote's paragraph should contain both pieces.
		expect(src).toMatch(/> target inside bqouter para/);
	});

	test('copy across container boundary (blockquote → top-level), paste into fresh document', async () => {
		await editor.loadContent('> bq content\n\nouter para\n');

		// Cross-container selection: start in blockquote, end in top-level paragraph.
		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([1], 'outer para'.length);
		await editor.waitForCrossBlock(true);

		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(100);

		// Load fresh document and paste.
		await editor.loadContent('destination\n');
		await editor.focusBlockAtPath([0], 'destination'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = await editor.getSource();
		// Both pieces of selected content should land in the destination.
		expect(src).toContain('bq content');
		expect(src).toContain('outer para');
	});
});
