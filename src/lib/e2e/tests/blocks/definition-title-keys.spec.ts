import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/** The top-level blocks as the editor holds them: each one's kind and bytes. */
const blocks = (page: Page): Promise<[string, string][]> =>
	page.evaluate(() =>
		(window as any).__test
			.getDocument()
			.children.map((node: { kind: string; raw: string }) => [node.kind, node.raw])
	);

const STARTED = '[a]: /u\n    "code\n[b]: /v\n[b]: /v\nend\n';

test.describe('keys under a definition whose title has started', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a quote that closes the title makes the lines above it one definition', async ({
		page
	}) => {
		await editor.loadContent(STARTED);
		expect((await blocks(page)).map(([kind]) => kind)).toEqual([
			'linkReferenceDefinition',
			'indentedCode',
			'linkReferenceDefinition',
			'linkReferenceDefinition',
			'paragraph'
		]);

		await editor.clickBlockAtPath([4], 3);
		await page.keyboard.press('"');
		await editor.waitForRenderFlush();

		const closed = '[a]: /u\n    "code\n[b]: /v\n[b]: /v\nend"\n';
		expect(await blocks(page)).toEqual([['linkReferenceDefinition', closed]]);
		const caret = await editor.bridge.getSelection();
		expect(caret?.focus).toMatchObject({ path: [0], offset: closed.length - 1 });
	});

	test('Enter inside a title that runs over lines opens a blank line there', async ({ page }) => {
		await editor.loadContent("[a]: /u\n    'code\ntext\nend'\n");
		expect(await blocks(page)).toHaveLength(1);

		await editor.clickBlockAtPath([0], '[a]: /u'.length);
		await page.keyboard.press('Enter');
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe("[a]: /u\n\n    'code\ntext\nend'\n");
		expect((await blocks(page)).map(([kind]) => kind)).toEqual([
			'linkReferenceDefinition',
			'indentedCode',
			'paragraph'
		]);
		const caret = await editor.bridge.getSelection();
		expect(caret?.focus).toMatchObject({ path: [1], offset: 0 });
	});

	test('undo gives back the blocks the title took', async ({ page }) => {
		await editor.loadContent(STARTED);
		await editor.clickBlockAtPath([4], 3);
		await page.keyboard.press('"');
		await editor.waitForRenderFlush();
		expect(await blocks(page)).toHaveLength(1);

		await editor.undo();
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe(STARTED);
		expect(await blocks(page)).toHaveLength(5);
	});
});
