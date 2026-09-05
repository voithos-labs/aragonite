import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list Backspace — U1 unwrap on first item', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at start of non-empty first item unwraps to a plain paragraph', async () => {
		await editor.loadContent('Before\n\n- Item one\n- Item two\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Item one' });
		await item.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^Item one/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^Item one/m);
		expect(source).toMatch(/^- Item two/m);
		expect(source).toContain('Before');
	});

	test('Backspace on single-item list (non-empty) removes the list entirely and lands cursor at the lifted paragraph', async () => {
		await editor.loadContent('- Solo\n');
		const item = editor.page.locator('[contenteditable="true"]').first();
		await item.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		// Byte-exact: the marker's raw-0 offset translation must leave no residue of the list.
		await editor.bridge.waitForSourceEquals('Solo\n');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('ZSolo');
	});

	test('Backspace on first item with matching-type nested sub-list: nested items promote to parent list level', async () => {
		await editor.loadContent('- First\n  - Nested\n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^First/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^First/m);
		expect(source).toMatch(/^- Nested/m);
		expect(source).toMatch(/^- Second/m);
	});

	test('Backspace on first item with mismatched-type nested sub-list: sub-list becomes separate block', async () => {
		await editor.loadContent('- First\n  1. OrderedNested\n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^First/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^First/m);
		expect(source).toMatch(/^1\. OrderedNested/m);
		expect(source).toMatch(/^- Second/m);
	});

	test('Backspace on first item of ordered list: remaining items renumber from base', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^1\. Second/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^First/m);
		expect(source).not.toMatch(/^1\. First/m);
		expect(source).toMatch(/^1\. Second/m);
		expect(source).toMatch(/^2\. Third/m);
	});

	// Google Docs semantics: post-blank item promotes to paragraph, remaining items continue the sequence (no Obsidian restart).
	test('ordered: Backspace on post-blank item promotes to paragraph and continues numbering', async () => {
		await editor.loadContent('1. one\n2. two\n\n3. three\n4. four\n');
		const third = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await third.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^three$/m);
		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^\d+\. three$/m);
		expect(source).toMatch(/^three$/m);
		expect(source).toMatch(/^3\. four$/m);
		expect(source).not.toMatch(/^4\. four$/m);
		expect(source).not.toMatch(/^1\. four$/m);
	});
});
