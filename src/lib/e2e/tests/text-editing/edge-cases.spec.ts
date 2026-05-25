import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

test.describe('text editing — edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at offset 0 — leading blank line absorbed as trivia, single block round-trips', async () => {
		// Regression: G3. performSplit at offset 0 of a non-empty block
		// synthesized an empty leading paragraph (raw='\n') that collapses
		// into trivia on reparse, so liveChildren=2 desynced from
		// reparsedCount=1. The action now routes to a leadingTrivia bump,
		// keeping the live tree and serialize+reparse view aligned.
		await editor.loadContent('Content\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('\nContent\n');

		const probe = await editor.page.evaluate(() => {
			const doc = (window as any).__test.getDocument();
			return {
				liveChildren: doc.children.length,
				leadingTrivia: doc.children[0]?.leadingTrivia,
				raw: doc.children[0]?.raw,
				reparsedCount: (window as any).__test.getBlockCount(),
				domBlocks: document.querySelectorAll('.block-host').length
			};
		});

		expect(probe.liveChildren).toBe(1);
		expect(probe.reparsedCount).toBe(1);
		expect(probe.leadingTrivia).toBe('\n');
		expect(probe.raw).toBe('Content\n');
		expect(probe.domBlocks).toBe(1);
	});

	test('Backspace at start of first block does nothing', async () => {
		await editor.loadContent('Only block\n');
		const sourceBefore = await editor.bridge.getSource();

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Backspace');

		const sourceAfter = await editor.bridge.getSource();
		expect(sourceAfter).toBe(sourceBefore);
	});

	test('Backspace at start of heading after heading — no merge, moves focus', async () => {
		await editor.loadContent('# Heading A\n\n## Heading B\n');
		const countBefore = await editor.bridge.getBlockCount();

		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Backspace');

		const countAfter = await editor.bridge.getBlockCount();
		expect(countAfter).toBe(countBefore);
	});

	test('heading absorbs following paragraph on merge', async () => {
		await editor.loadContent('# Title\n\nBody text\n');
		await editor.focusBlockStart(1);
		await editor.page.keyboard.press('Backspace');

		const source = await editor.bridge.getSource();
		expect(source).toContain('TitleBody text');
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
	});

	test('Backspace after thematic break deletes the break', async () => {
		await editor.loadContent('Before\n\n---\n\nAfter\n');
		const countBefore = await editor.bridge.getBlockCount();

		await editor.focusBlockStart(2);
		await editor.page.keyboard.press('Backspace');

		const countAfter = await editor.bridge.getBlockCount();
		expect(countAfter).toBeLessThan(countBefore);

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('---');
	});

	test('kind change reversal — deleting # prefix reverts heading to paragraph', async () => {
		await editor.loadContent('# Title\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Backspace');

		const kind = await editor.bridge.getBlockKind(0);
		expect(kind).toBe('paragraph');
	});

	test('split heading at middle — first stays heading, second becomes paragraph', async () => {
		await editor.loadContent('# HelloWorld\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');

		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});

	test('Enter at end of heading — heading unchanged, new empty paragraph', async () => {
		await editor.loadContent('# Heading\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');

		const domCount = await editor.getDomBlockCount();
		expect(domCount).toBe(2);
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
		// Empty block may be absorbed as trivia by the parser — verify via DOM.
		const secondBlock = editor.getBlock(1);
		await expect(secondBlock).toBeVisible();
	});
});
