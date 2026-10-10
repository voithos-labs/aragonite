import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { reloadReady } from '../goto-ready';
import { DEFAULT_CONTENT } from '../test-content';

const TOGGLE_CHORD = 'ControlOrMeta+Shift+D';

test.describe('debug panel', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DEFAULT_CONTENT);
	});

	test('the hotkey toggles the panel, Esc closes it, and the editor takes no stray character', async () => {
		const panel = editor.page.locator('.debug-panel');
		await expect(panel).toHaveCount(0);

		await editor.page.keyboard.press(TOGGLE_CHORD);
		await expect(panel).toBeVisible();

		await editor.page.keyboard.press(TOGGLE_CHORD);
		await expect(panel).toHaveCount(0);

		await test.step('Esc while the panel is focused closes it', async () => {
			await editor.page.keyboard.press(TOGGLE_CHORD);
			await panel.focus();
			await editor.page.keyboard.press('Escape');
			await expect(panel).toHaveCount(0);
		});

		await test.step('with focus in the editor the hotkey still toggles and types nothing', async () => {
			await editor.clickBlock(0);
			await editor.page.keyboard.press(TOGGLE_CHORD);
			await expect(panel).toBeVisible();

			const source = await editor.bridge.getSource();
			const linesWithStrayD = source
				.split('\n')
				.filter((l) => l.trim() === 'd' || l.trim() === 'D');
			expect(linesWithStrayD).toHaveLength(0);
		});
	});

	test('panel open state survives a page reload', async () => {
		await editor.page.keyboard.press(TOGGLE_CHORD);
		await expect(editor.page.locator('.debug-panel')).toBeVisible();

		await reloadReady(editor.page);

		await expect(editor.page.locator('.debug-panel')).toBeVisible();
	});

	test('all seven sections render in document order and CST body is populated', async () => {
		await editor.page.keyboard.press(TOGGLE_CHORD);

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

		// The tree section is open by default, so its body must contain block [0].
		await expect(
			editor.page.locator('.debug-section[data-section-title="CST tree"] .debug-section-body')
		).toContainText('[0]');

		// Read-only by design: a repro goes in through `setSource`, not a textarea.
		const rawBody = editor.page.locator(
			'.debug-section[data-section-title="Raw source"] .debug-section-body'
		);
		await expect(rawBody).toBeVisible();
		await expect(rawBody.locator('textarea')).toHaveCount(0);
	});

	test('copy-all button writes a fenced snapshot to the clipboard', async () => {
		await editor.page.keyboard.press(TOGGLE_CHORD);
		await editor.page.locator('.debug-panel .copy-all').click();

		const clip = await editor.readClipboard();
		expect(clip).toContain('# Debug snapshot —');
		expect(clip).toContain('### CST');
		expect(clip).toContain('### Raw source');
		expect(clip).toContain('### Operations log');
		expect(clip).toContain('### Interaction trace');
	});

	// The order is the subject: the tree must fill in whether the block gains focus before or
	// after the section opens.
	for (const order of ['click-first', 'expand-first'] as const) {
		test(`inline tree populates when the block is focused ${order === 'click-first' ? 'before' : 'after'} the section expands`, async () => {
			await editor.page.keyboard.press(TOGGLE_CHORD);
			const header = editor.page.locator(
				'.debug-section[data-section-title="Inline tree (focused block)"] .debug-section-header'
			);
			if (order === 'click-first') {
				await editor.clickBlock(3);
				await header.click();
			} else {
				await header.click();
				await editor.clickBlock(3);
			}
			const body = editor.page.locator(
				'.debug-section[data-section-title="Inline tree (focused block)"] .debug-section-body'
			);
			for (const kind of ['strong', 'emphasis', 'strikethrough', 'inlineCode']) {
				await expect(body).toContainText(kind);
			}
		});
	}

	test('selection section shows the focused block path when user clicks in a block', async () => {
		await editor.page.keyboard.press(TOGGLE_CHORD);
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

		// The rebuild happens a tick after the keystroke finishes, so poll rather than reading
		// once straight away.
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
});
