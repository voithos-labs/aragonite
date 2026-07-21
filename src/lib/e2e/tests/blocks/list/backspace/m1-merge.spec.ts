import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { getContainerParityMismatches } from '../../../../container-parity';
import { capturePageErrors } from '../../../../page-probes';

test.describe('list Backspace — M1 merge on non-first item', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace at start of non-empty non-first item merges into previous item (rule B: deepest visible above)', async () => {
		await editor.loadContent('- Item one\n- Item two\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Item two' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('Item oneItem two');

		const source = await editor.bridge.getSource();
		expect(source).toContain('Item oneItem two');
		expect((source.match(/^- /gm) ?? []).length).toBe(1);
	});

	test('M1 row 2: current item has nested sub-list; nested absorbed into target', async () => {
		await editor.loadContent('- A\n- B\n  - C\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('- AB');

		const source = await editor.bridge.getSource();
		expect(source).toContain('- AB');
		expect(source).toMatch(/^\s+- C/m);
	});

	test('M1 row 3: target nested in previous item; current-item nested children become sibling of target (preserve absolute indent)', async () => {
		await editor.loadContent('- A\n  - AA\n- B\n  - C\n');
		const bItem = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await bItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/- AAB/);

		const source = await editor.bridge.getSource();
		expect(source).toContain('- A');
		expect(source).toMatch(/- AAB/);
		expect(source).toMatch(/- AAB\s*\n\s+- C/);
	});

	test('M1 row 4 (deep nesting): E preserves its original absolute depth of 1, sibling of B', async () => {
		const content = '- A\n  - B\n    - C\n- D\n  - E\n';
		await editor.loadContent(content);
		const dItem = editor.page.locator('[contenteditable="true"]', { hasText: 'D' }).first();
		await dItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^ {4}- CD/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^ {4}- CD/m);
		expect(source).toMatch(/^ {2}- B/m);
		expect(source).toMatch(/^ {2}- E/m);
	});

	test('M1 row 5: current item has non-listItem continuation paragraph; absorbed into target item children', async () => {
		await editor.loadContent('- A\n- B\n\n  extra\n');
		const bItem = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await bItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('- AB');

		const source = await editor.bridge.getSource();
		expect(source).toContain('- AB');
		expect(source).toMatch(/extra/);
	});

	test('M1 ordered list: merged item deletion renumbers remaining', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^1\. FirstSecond/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. FirstSecond/m);
		expect(source).toMatch(/^2\. Third/m);
	});

	test('M1 cursor lands at merge point in target', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const betaItem = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await betaItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('AlphaBeta');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('AlphaZBeta');
		const source = await editor.bridge.getSource();
		expect(source).toContain('AlphaZBeta');
	});

	// Live children-vs-childIds parity at every container depth. Before the
	// fix the M1 helper mutated inner-container `children` without extending
	// `childIds`, so Svelte's keyed each logged `each_key_duplicate` for the
	// trailing undefined keys.
	test('M1 keeps children/childIds parity at every depth (rows 3+4 shape)', async ({ page }) => {
		const consoleErrors: string[] = [];
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text());
		});
		const pageErrors = capturePageErrors(page);

		await editor.loadContent('- A\n  - B\n    - C\n- D\n  - E\n');
		const dItem = editor.page.locator('[contenteditable="true"]', { hasText: 'D' }).first();
		await dItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^ {4}- CD/m);

		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
		expect(consoleErrors.filter((m) => /each_key_duplicate/.test(m))).toEqual([]);
	});

	test('M1 opaque previous leaf (fenced code): no merge, no crash, caret falls back', async ({
		page
	}) => {
		// Regression: Backspace at start of the item after a fenced-code-only item
		// once threw inside the commit ceremony (DEV crash / prod dead key). It must
		// now no-op structurally and move the caret to the previous item's code block.
		const pageErrors = capturePageErrors(page);

		await editor.loadContent('- ```\n  code\n  ```\n- text\n');
		const textItem = editor.page.locator('[contenteditable="true"]', { hasText: 'text' }).first();
		await textItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.waitForRenderFlush();

		const source = await editor.bridge.getSource();
		expect(source).toContain('code');
		expect(source).toContain('text');
		// No merge: both items survive, and 'text' is not appended to the code block.
		expect((source.match(/^- /gm) ?? []).length).toBe(2);
		expect(source).not.toContain('codetext');
		expect(pageErrors).toEqual([]);
	});

	test('ordered: deleting item renumbers subsequent', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForListItemCount(4);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/3\.\s*Third/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/1\.\s*First/);
		expect(source).toMatch(/2\.\s*Second/);
		expect(source).toMatch(/3\.\s*Third/);
	});
});
