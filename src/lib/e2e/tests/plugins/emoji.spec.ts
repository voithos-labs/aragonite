import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * `:shortcode:` emoji as atomic glyph widgets on the bare `:` trigger. The literal
 * bytes stay in the source; the widget shows only the glyph and carries the
 * decoded-entity editing policy (atomic delete, step-over). Seed `emoji`: block 0
 * `Mood :smile: today` (widget at raw [5,12)), block 1 `Type here`.
 *
 * The load-bearing gestures are the caret-edge ones — a plain ArrowRight crosses the
 * whole widget in one press, a caret-adjacent Backspace deletes all seven bytes in
 * one commit — which only the real render path and its edge-policy dispatch exercise.
 */

const emojiIn = (editor: PluginsPage, block: number) =>
	editor.page.locator(`[data-block-path='[${block}]'] .md-emoji-widget`);

test.describe('plugin inline emoji shortcodes', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('emoji');
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test('renders a seeded shortcode as a glyph widget, bytes preserved', async () => {
		const widget = emojiIn(editor, 0);
		await expect(widget).toHaveCount(1);
		await expect(widget).toHaveText('😄');
		expect(await editor.bridge.getSource()).toContain('Mood :smile: today');
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('a shortcode typed live renders once its closing colon lands', async ({ page }) => {
		await editor.focusBlockEnd(1);
		await editor.typeText(' :tada');
		await editor.waitForRenderFlush();
		// Unterminated: still literal text, no widget yet.
		await expect(emojiIn(editor, 1)).toHaveCount(0);

		await editor.typeText(':');
		await editor.bridge.waitForSourceContains(':tada:');
		await expect(emojiIn(editor, 1)).toHaveCount(1);
		await expect(emojiIn(editor, 1)).toHaveText('🎉');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a plain arrow steps the caret over the whole widget like a character', async ({ page }) => {
		// From the block start, five ArrowRights reach the widget's leading edge (past
		// "Mood "); the sixth crosses the atomic island in one press. A character typed
		// next lands immediately after the closing colon — proof the caret stepped over
		// all seven bytes, not into them.
		await editor.focusBlockStart(0);
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains(':smile:X');
		expect(await editor.bridge.getSource()).toContain('Mood :smile:X today');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a caret-adjacent Backspace deletes the whole reference in one press and one undo', async ({
		page
	}) => {
		// Six ArrowRights land the caret at the widget's trailing edge (stepping over the
		// island); one Backspace removes all seven `:smile:` bytes.
		await editor.focusBlockStart(0);
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => !s.includes(':smile:'));
		await expect(emojiIn(editor, 0)).toHaveCount(0);
		expect(await editor.bridge.getSource()).toContain('Mood  today');

		// One undo restores the reference whole — the atomic delete was a single commit.
		// Assert the exact original source, not mere containment, so a partial restore fails.
		await editor.waitForUndoBatchFlush();
		await editor.undo();
		await editor.bridge.waitForSourceContains(':smile:');
		await expect(emojiIn(editor, 0)).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe('Mood :smile: today\n\nType here\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('copying a range containing the reference yields the :name: bytes', async ({ page }) => {
		await editor.focusBlockStart(0);
		await editor.selectAll();
		await page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		const copied = await page.evaluate(() => navigator.clipboard.readText());
		expect(copied).toContain(':smile:');
		expect(copied).not.toContain('😄');
		expect(await capturedErrors(page)).toEqual([]);
	});
});
