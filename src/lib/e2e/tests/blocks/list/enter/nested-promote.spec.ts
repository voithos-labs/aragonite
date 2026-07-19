import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list Enter — nested item promote (Shift+Tab semantics)', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Regression: Enter on an empty nested item used to escape into the
	// containing list item as a bare paragraph, leaving a trailing orphan
	// paragraph. Expected is Shift+Tab semantics — promote one level.
	test('Enter on empty nested item promotes to parent list instead of escaping', async () => {
		await editor.loadContent('- item\n  - nested\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'nested' });
		await nested.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForListItemCount(3);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^- $/m);
		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/^- X$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- item$/m);
		expect(source).toMatch(/^ {2}- nested$/m);
		// Promoted to outer list — "- X" at column 0, no indent.
		expect(source).toMatch(/^- X$/m);
		// The buggy path produced a bare "X" paragraph (no marker) instead.
		expect(source).not.toMatch(/^X$/m);
	});

	test('third Enter after promote exits the outer list to a paragraph', async () => {
		await editor.loadContent('- item\n  - nested\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'nested' });
		await nested.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForListItemCount(3);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^- $/m);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => !/^- $/m.test(s));
		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/^X$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- item$/m);
		expect(source).toMatch(/^ {2}- nested$/m);
		// Escaped to document-level paragraph — no marker, no indent.
		expect(source).toMatch(/^X$/m);
		expect(source).not.toMatch(/^- X$/m);
		expect(source).not.toMatch(/^ {2}- X$/m);
	});

	test('Enter on empty 3-level-nested item promotes one level per press', async () => {
		await editor.loadContent('- a\n  - b\n    - c\n');
		const c = editor.page.locator('[contenteditable="true"]', { hasText: 'c' });
		await c.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForListItemCount(4);
		await editor.page.keyboard.press('Enter');
		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/^ {2}- X$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- a$/m);
		expect(source).toMatch(/^ {2}- b$/m);
		expect(source).toMatch(/^ {4}- c$/m);
		// Promoted from level 3 to level 2 — two-space indent.
		expect(source).toMatch(/^ {2}- X$/m);
		expect(source).not.toMatch(/^ {4}- X$/m);
	});
});
