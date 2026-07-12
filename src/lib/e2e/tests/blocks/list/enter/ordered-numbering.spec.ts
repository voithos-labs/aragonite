import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list Enter — ordered numbering', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered: new item gets next number and subsequent renumber', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^3\.\s*Second/m);
		await editor.typeText('New');
		await editor.bridge.waitForSourceMatches(/2\.\s*New/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/2\.\s*New/);
		expect(source).toMatch(/3\.\s*Second/);
		expect(source).toMatch(/4\.\s*Third/);
	});

	test('ordered: Enter at start of first item numbers correctly', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => {
			const numbers = (s.match(/^(\d+)\./gm) || []).map(Number);
			return numbers.length >= 2 && new Set(numbers).size === numbers.length;
		});
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/1\./);
		expect(source).toContain('First');
		const numbers = (source.match(/^(\d+)\./gm) || []).map(Number);
		const unique = new Set(numbers);
		expect(unique.size).toBe(numbers.length);
	});

	test('ordered: Enter on empty first item renumbers remaining list', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('First'));
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^1\. Second$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. Second$/m);
		expect(source).not.toMatch(/^2\. Second$/m);
	});

	// Google Docs / Obsidian semantics: exit paragraph doesn't consume a marker number.
	test('ordered: Enter on empty middle item renumbers second half continuously', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n4. four\n');
		const third = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await third.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('three'));
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^3\. four$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. one$/m);
		expect(source).toMatch(/^2\. two$/m);
		expect(source).toMatch(/^3\. four$/m);
		expect(source).not.toMatch(/^4\. four$/m);
		expect(source).not.toMatch(/^1\. four$/m);
	});

	test('ordered: double-Enter at end of middle item exits with continuous numbering', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'two' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^4\. three$/m);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => /^3\. three$/m.test(s) && !/^4\. three$/m.test(s));
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. one$/m);
		expect(source).toMatch(/^2\. two$/m);
		expect(source).toMatch(/^3\. three$/m);
		expect(source).not.toMatch(/^4\. three$/m);
	});

	test('ordered: Enter at end of last item in loose list appends continuing item', async () => {
		await editor.loadContent('1. one\n2. two\n\n3. three\n');
		const third = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await third.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForListItemCount(4);
		await editor.typeText('new');
		await editor.bridge.waitForSourceMatches(/^4\. new$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. one$/m);
		expect(source).toMatch(/^2\. two$/m);
		expect(source).toMatch(/^3\. three$/m);
		expect(source).toMatch(/^4\. new$/m);
	});
});
