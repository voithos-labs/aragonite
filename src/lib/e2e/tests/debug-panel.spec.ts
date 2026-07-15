import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { DEFAULT_CONTENT } from '../test-content';
import { primaryModifier } from '../platform';

function toggleKey(): string {
	return `${primaryModifier}+Shift+D`;
}

test.describe('debug panel', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.page.evaluate(() => localStorage.removeItem('aragonite.debug-panel.state.v1'));
		await editor.page.reload();
		await editor.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
		await editor.loadContent(DEFAULT_CONTENT);
	});

	test('hotkey opens panel from closed state then closes it again', async () => {
		await expect(editor.page.locator('.debug-panel')).toHaveCount(0);

		await editor.page.keyboard.press(toggleKey());
		await expect(editor.page.locator('.debug-panel')).toBeVisible();

		await editor.page.keyboard.press(toggleKey());
		await expect(editor.page.locator('.debug-panel')).toHaveCount(0);
	});

	test('panel open state survives a page reload', async () => {
		await editor.page.keyboard.press(toggleKey());
		await expect(editor.page.locator('.debug-panel')).toBeVisible();

		await editor.page.reload();
		await editor.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});

		await expect(editor.page.locator('.debug-panel')).toBeVisible();
	});

	test('all seven sections render in document order and CST body is populated', async () => {
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
			'Operations log',
			'Interaction trace'
		]);

		// CST tree is expanded by default — body must contain block [0].
		await expect(
			editor.page.locator('.debug-section[data-section-title="CST tree"] .debug-section-body')
		).toContainText('[0]');
	});

	test('Esc while panel is focused closes the panel', async () => {
		await editor.page.keyboard.press(toggleKey());
		await editor.page.locator('.debug-panel').focus();
		await editor.page.keyboard.press('Escape');
		await expect(editor.page.locator('.debug-panel')).toHaveCount(0);
	});

	test('raw-source section is not a textarea (read-only by design)', async () => {
		await editor.page.keyboard.press(toggleKey());
		const rawBody = editor.page.locator(
			'.debug-section[data-section-title="Raw source"] .debug-section-body'
		);
		await expect(rawBody).toBeVisible();
		await expect(rawBody.locator('textarea')).toHaveCount(0);
	});

	test('copy-all button writes a fenced snapshot to the clipboard', async () => {
		await editor.page.keyboard.press(toggleKey());
		await editor.page.locator('.debug-panel .copy-all').click();

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('# Debug snapshot —');
		expect(clip).toContain('### CST');
		expect(clip).toContain('### Raw source');
		expect(clip).toContain('### Operations log');
		expect(clip).toContain('### Interaction trace');
	});

	test('inline tree populates when user clicks block FIRST, then expands the section', async () => {
		await editor.page.keyboard.press(toggleKey());
		await editor.clickBlock(3);
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

	test('inline tree populates with inline-node kinds when caret is placed in a formatted prose block', async () => {
		await editor.page.keyboard.press(toggleKey());
		await editor.page
			.locator(
				'.debug-section[data-section-title="Inline tree (focused block)"] .debug-section-header'
			)
			.click();
		await editor.clickBlock(3);
		const body = editor.page.locator(
			'.debug-section[data-section-title="Inline tree (focused block)"] .debug-section-body'
		);
		await expect(body).toContainText('strong');
		await expect(body).toContainText('emphasis');
		await expect(body).toContainText('strikethrough');
		await expect(body).toContainText('inlineCode');
	});

	test('selection section shows the focused block path when user clicks in a block', async () => {
		await editor.page.keyboard.press(toggleKey());
		await editor.page
			.locator('.debug-section[data-section-title="Selection"] .debug-section-header')
			.click();
		await editor.clickBlock(3);
		const body = editor.page.locator(
			'.debug-section[data-section-title="Selection"] .debug-section-body'
		);
		await expect(body).toContainText('[3]');
	});

	test('interaction trace records a rebuild on typing, with no composition entries', async () => {
		await editor.clickBlock(0);
		await editor.page.evaluate(() => (window as any).__test.trace.enable());
		await editor.page.keyboard.type('z');

		// The rebuild lands a reactive tick after the keystroke resolves — poll, don't
		// snapshot synchronously.
		await editor.page.waitForFunction(() =>
			(window as any).__test.trace
				.snapshot()
				.some(
					(e: { site: string; kind: string }) => e.site === 'text-render' && e.kind === 'rebuild'
				)
		);

		const snap = await editor.page.evaluate(
			() => (window as any).__test.trace.snapshot() as { site: string; kind: string }[]
		);
		expect(snap.some((e) => e.site === 'text-render' && e.kind === 'rebuild')).toBe(true);
		// Plain keystrokes are not IME composition.
		expect(snap.some((e) => e.site === 'composition')).toBe(false);
	});

	test('serializeDiagnostics excludes the document by default, includes it only on opt-in', async () => {
		// A distinctive token that can only reach the report via the Source section —
		// the trace/ops/selection sections carry offsets and counts, never raw text.
		await editor.loadContent('PRIVATEZZ token in the document body\n');

		const byDefault = await editor.page.evaluate(() =>
			(window as any).__test.serializeDiagnostics()
		);
		// The privacy pin lives at the door's `?? false` default, not the builder.
		expect(byDefault).toContain('## Selection');
		expect(byDefault).not.toContain('PRIVATEZZ');

		const optedIn = await editor.page.evaluate(() =>
			(window as any).__test.serializeDiagnostics({ includeSource: true })
		);
		expect(optedIn).toContain('## Source');
		expect(optedIn).toContain('PRIVATEZZ');
	});

	test('hotkey with focus in the editor toggles panel without inserting a character', async () => {
		await editor.clickBlock(0);

		await editor.page.keyboard.press(toggleKey());
		await expect(editor.page.locator('.debug-panel')).toBeVisible();

		const source = await editor.bridge.getSource();
		const linesWithStrayD = source.split('\n').filter((l) => l.trim() === 'd' || l.trim() === 'D');
		expect(linesWithStrayD).toHaveLength(0);
	});
});
