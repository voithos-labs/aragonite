import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { edgeKey, extendKey } from '../../../../platform-keys';

test.describe('list Enter: ordered numbering', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered: new item gets next number and subsequent renumber', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^3\.\s*Second/m);
		await editor.typeText('New');
		await editor.bridge.waitForSourceMatches(/2\.\s*New/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/2\.\s*New/);
		expect(source).toMatch(/3\.\s*Second/);
		expect(source).toMatch(/4\.\s*Third/);
	});

	// The new item and those after it count on as the list's first two numbers do.
	for (const { list, entered } of [
		{ list: '1. a\n1. b\n1. c\n', entered: '1. a\n1. \n1. b\n1. c\n' },
		{ list: '0. a\n1. b\n', entered: '0. a\n1. \n2. b\n' },
		{ list: '3. a\n5. b\n7. c\n', entered: '3. a\n4. \n5. b\n6. c\n' }
	]) {
		test(`ordered: Enter at the end of a in ${JSON.stringify(list)}`, async () => {
			await editor.loadContent(list);
			await editor.focusBlockAtPath([0, 0, 0], 1);
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceEquals(entered);
		});
	}

	test('ordered: Enter at start of first item numbers correctly', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press(edgeKey('lineStart'));
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
		await editor.page.keyboard.press(edgeKey('lineStart'));
		await editor.page.keyboard.press(extendKey('lineEnd'));
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('First'));
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^1\. Second$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. Second$/m);
		expect(source).not.toMatch(/^2\. Second$/m);
	});

	// The exit paragraph takes no marker number, so the second half renumbers continuously.
	test('ordered: Enter on empty middle item renumbers second half continuously', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n4. four\n');
		const third = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await third.click();
		await editor.page.keyboard.press(edgeKey('lineStart'));
		await editor.page.keyboard.press(extendKey('lineEnd'));
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('three'));
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^3\. four$/m);
		expect(await editor.bridge.getSource()).toBe('1. one\n2. two\n\n\n3. four\n');
	});

	// The exit's empty paragraph is itself a blank line, so it and the list below share one.
	for (const [where, source, exited, typed] of [
		[
			'',
			'1. one\n2. two\n3. three\n',
			'1. one\n2. two\n\n\n3. three\n',
			'1. one\n2. two\n\nlead\n\n3. three\n'
		],
		[
			' in a quote',
			'> 1. one\n> 2. two\n> 3. three\n',
			'> 1. one\n> 2. two\n>\n>\n> 3. three\n',
			'> 1. one\n> 2. two\n>\n> lead\n>\n> 3. three\n'
		]
	]) {
		test(`ordered: double-Enter at end of middle item exits with continuous numbering${where}`, async () => {
			await editor.loadContent(source);
			const second = editor.page.locator('[contenteditable="true"]', { hasText: 'two' });
			await second.click();
			await editor.page.keyboard.press(edgeKey('lineEnd'));
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceMatches(/^(> )?4\. three$/m);
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceMatches(/^(> )?3\. three$/m);
			expect(await editor.bridge.getSource()).toBe(exited);
			await editor.typeText('lead');
			await editor.bridge.waitForSourceContains('lead');
			expect(await editor.bridge.getSource()).toBe(typed);
		});
	}

	test('ordered: Enter at end of last item in loose list appends continuing item', async () => {
		await editor.loadContent('1. one\n2. two\n\n3. three\n');
		const third = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await third.click();
		await editor.page.keyboard.press(edgeKey('lineEnd'));
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
