// One invariant — container-block navigation surviving the index shift a structural op causes
// — parametrized across split, M1 merge, and cross-container merge.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

test.describe('focus traversal after block insertion', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ArrowDown traverses every block after splitBlock near containers', async () => {
		// A stale index prop on a container block makes focus skip blocks after the split.
		const content = [
			'# Title',
			'',
			'Paragraph before break.',
			'',
			'---',
			'',
			'> Quote line one',
			'>',
			'> Quote line two',
			'',
			'- Item one',
			'- Item two',
			'',
			'```',
			'code here',
			'```',
			'',
			'Final text.',
			''
		].join('\n');

		await editor.loadContent(content);

		const hostsBefore = await editor.page.locator('.block-host').count();
		await editor.focusBlockEnd(1);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(hostsBefore + 1);

		const bqBlock = editor.getBlock(4);
		const bqEditable = bqBlock.locator('[contenteditable="true"]').last();
		await bqEditable.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowDown');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/- .*Item one.*Z|Z.*Item one/m);
	});

	test('ArrowDown exits list to correct next block after splitBlock', async () => {
		const content = [
			'Some text.',
			'',
			'- Item one',
			'- Item two',
			'',
			'```',
			'code',
			'```',
			'',
			'After code.',
			''
		].join('\n');

		await editor.loadContent(content);

		const hostsBefore = await editor.page.locator('.block-host').count();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(hostsBefore + 1);

		const listBlock = editor.getBlock(2);
		const listEditables = listBlock.locator('[contenteditable="true"]');
		const lastItem = listEditables.last();
		await lastItem.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowDown');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/Z```|```Z|codeZ|Zcode/);

		expect(await editor.bridge.getSource()).not.toMatch(/ZAfter code/);
	});

	test('ArrowDown traverses correctly after M1 list merge near a container', async () => {
		const content = [
			'- Item one',
			'- Item two',
			'',
			'```',
			'code',
			'```',
			'',
			'Final text.',
			''
		].join('\n');

		await editor.loadContent(content);

		const itemTwo = editor.page.locator('[contenteditable="true"]', { hasText: 'Item two' });
		await itemTwo.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^- Item oneItem two$/m);

		const listBlock = editor.getBlock(0);
		const listEditable = listBlock.locator('[contenteditable="true"]').first();
		await listEditable.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowDown');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/Z```|```Z|codeZ|Zcode/);

		expect(await editor.bridge.getSource()).not.toMatch(/ZFinal/);
	});

	test('ArrowDown traverses correctly after cross-container merge into blockquote', async () => {
		// Blank-line separator required due to lazy continuation.
		const content = ['> quote line', '', 'text', '', '```', 'code', '```', '', 'Final.', ''].join(
			'\n'
		);

		await editor.loadContent(content);

		const para = editor.page.locator('[contenteditable="true"]', { hasText: /^text$/ });
		await para.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('> quote linetext');

		const bqEditable = editor.getBlock(0).locator('[contenteditable="true"]').first();
		await bqEditable.click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press('ArrowDown');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceMatches(/Z```|```Z|codeZ|Zcode/);

		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/ZFinal/);
		expect(source).toContain('> quote linetext');
	});
});
