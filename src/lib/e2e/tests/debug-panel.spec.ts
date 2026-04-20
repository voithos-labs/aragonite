import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Ctrl on Windows/Linux, Meta on macOS. */
function modifier(): string {
	return process.platform === 'darwin' ? 'Meta' : 'Control';
}

function toggleKey(): string {
	return `${modifier()}+Shift+D`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('debug panel', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		// Clear persisted panel state from any prior test run so each test
		// starts from the default closed state.
		await editor.page.evaluate(() => localStorage.removeItem('limestone.debug-panel.state.v1'));
		await editor.page.reload();
		await editor.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	});

	// ── Toggle ────────────────────────────────────────────────────────────────

	test('hotkey opens panel from closed state then closes it again', async () => {
		await expect(editor.page.locator('.debug-panel')).toHaveCount(0);

		await editor.page.keyboard.press(toggleKey());
		await expect(editor.page.locator('.debug-panel')).toBeVisible();

		await editor.page.keyboard.press(toggleKey());
		await expect(editor.page.locator('.debug-panel')).toHaveCount(0);
	});

	// ── Persistence ───────────────────────────────────────────────────────────

	test('panel open state survives a page reload', async () => {
		await editor.page.keyboard.press(toggleKey());
		await expect(editor.page.locator('.debug-panel')).toBeVisible();

		await editor.page.reload();
		await editor.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});

		await expect(editor.page.locator('.debug-panel')).toBeVisible();
	});

	// ── Section order ─────────────────────────────────────────────────────────

	test('all six sections render in document order and CST body is populated', async () => {
		await editor.page.keyboard.press(toggleKey());

		const titles = await editor.page
			.locator('.debug-section')
			.evaluateAll((sections) => sections.map((s) => s.getAttribute('data-section-title')));
		expect(titles).toEqual([
			'Raw source',
			'CST tree',
			'Selection',
			'Undo stack',
			'Inline tree (focused block)',
			'Operations log'
		]);

		// CST tree is expanded by default — its body must contain at least block [0].
		await expect(
			editor.page.locator('.debug-section[data-section-title="CST tree"] .debug-section-body')
		).toContainText('[0]');
	});

	// ── Esc to close ──────────────────────────────────────────────────────────

	test('Esc while panel is focused closes the panel', async () => {
		await editor.page.keyboard.press(toggleKey());
		await editor.page.locator('.debug-panel').focus();
		await editor.page.keyboard.press('Escape');
		await expect(editor.page.locator('.debug-panel')).toHaveCount(0);
	});

	// ── Raw source is read-only ───────────────────────────────────────────────

	test('raw-source section is not a textarea (read-only by design)', async () => {
		await editor.page.keyboard.press(toggleKey());
		const rawBody = editor.page.locator(
			'.debug-section[data-section-title="Raw source"] .debug-section-body'
		);
		await expect(rawBody).toBeVisible();
		// No textarea inside — the section shows live source as read-only text.
		await expect(rawBody.locator('textarea')).toHaveCount(0);
	});

	// ── Copy all ──────────────────────────────────────────────────────────────

	test('copy-all button writes a fenced snapshot to the clipboard', async () => {
		// Clipboard permissions are granted globally in playwright.config.ts.
		await editor.page.keyboard.press(toggleKey());
		await editor.page.locator('.debug-panel .copy-all').click();

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('# Debug snapshot —');
		expect(clip).toContain('### CST');
		expect(clip).toContain('### Raw source');
		expect(clip).toContain('### Operations log');
	});

	// ── Inline tree survives focus moving to the panel (click block, then expand) ──

	test('inline tree populates when user clicks block FIRST, then expands the section', async () => {
		await editor.page.keyboard.press(toggleKey());
		// User flow: click block 3 first (while inline section is still collapsed).
		await editor.clickBlock(3);
		// Then expand the inline tree section — this click moves focus to the button
		// and likely collapses the native selection to the button.
		await editor.page
			.locator(
				'.debug-section[data-section-title="Inline tree (focused block)"] .debug-section-header'
			)
			.click();
		const body = editor.page.locator(
			'.debug-section[data-section-title="Inline tree (focused block)"] .debug-section-body'
		);
		await expect(body).toContainText('strong');
		await expect(body).toContainText('emphasis');
	});

	// ── Inline tree reacts to caret placement ─────────────────────────────────

	test('inline tree populates with inline-node kinds when caret is placed in a formatted prose block', async () => {
		await editor.page.keyboard.press(toggleKey());
		// Inline tree section is collapsed by default; expand it.
		await editor.page
			.locator(
				'.debug-section[data-section-title="Inline tree (focused block)"] .debug-section-header'
			)
			.click();
		// Block 3 of DEFAULT_CONTENT is "A paragraph with **bold text**, *italic text*, ~~strikethrough~~, and `inline code`."
		await editor.clickBlock(3);
		const body = editor.page.locator(
			'.debug-section[data-section-title="Inline tree (focused block)"] .debug-section-body'
		);
		// Each recognized inline kind should show up in the dump.
		await expect(body).toContainText('strong');
		await expect(body).toContainText('emphasis');
		await expect(body).toContainText('strikethrough');
		await expect(body).toContainText('inlineCode');
	});

	// ── Selection section reacts to caret placement ───────────────────────────

	test('selection section shows the focused block path when user clicks in a block', async () => {
		await editor.page.keyboard.press(toggleKey());
		// Selection section is collapsed by default; expand it.
		await editor.page
			.locator('.debug-section[data-section-title="Selection"] .debug-section-header')
			.click();
		await editor.clickBlock(3);
		const body = editor.page.locator(
			'.debug-section[data-section-title="Selection"] .debug-section-body'
		);
		// Body must reference the focused block's path [3].
		await expect(body).toContainText('[3]');
	});

	// ── Hotkey with editor focused ────────────────────────────────────────────

	test('hotkey with focus in the editor toggles panel without inserting a character', async () => {
		// Focus the editor by clicking the first block.
		await editor.clickBlock(0);

		await editor.page.keyboard.press(toggleKey());
		await expect(editor.page.locator('.debug-panel')).toBeVisible();

		// The source must not contain a stray 'd' or 'D' from the hotkey.
		const source = await editor.getSource();
		const linesWithStrayD = source.split('\n').filter((l) => l.trim() === 'd' || l.trim() === 'D');
		expect(linesWithStrayD).toHaveLength(0);
	});
});
