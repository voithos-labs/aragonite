import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Enter at (or inside) a setext title keeps the trailing underline with the
// heading half — a plain raw cut demotes the heading and turns `-----` into a
// thematicBreak below. Requirements: enter-at-setext-end.md. The block-kind
// assertions are load-bearing: source bytes stay stable through the demotion,
// so only the live kinds distinguish the fix from the bug.

test.describe('text editing — Enter at the end of a setext title', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const underline of ['=====', '-----']) {
		const content = `Title\n${underline}\n`;

		test(`Enter at the end of a ${underline} title — heading survives, empty block below`, async () => {
			await editor.loadContent(content);
			await editor.focusBlockEnd(0);

			// The suffix rule only fires from the content end; a caret at raw end would
			// make the plain cut produce the same shape and hide a regression.
			const seeded = await editor.bridge.getSelectionPaths();
			expect(seeded?.focus).toEqual({ path: [0], offset: 5 });

			await editor.page.keyboard.press('Enter');
			await editor.waitForBlockHostCount(2);

			expect(await editor.bridge.getBlockKind(0)).toBe('setextHeading');
			expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
			await editor.bridge.waitForSourceEquals(content + '\n');
			expect(await editor.page.evaluate(() => (window as any).__test.parseConverged())).toBe(true);

			const selection = await editor.bridge.getSelectionPaths();
			expect(selection?.focus).toEqual({ path: [1], offset: 0 });
		});
	}

	test('Enter mid-title keeps the underline with the heading half', async () => {
		await editor.loadContent('Title\n=====\n');
		await editor.focusBlock(0, 2);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);

		expect(await editor.bridge.getBlockKind(0)).toBe('setextHeading');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		await editor.bridge.waitForSourceEquals('Ti\n=====\ntle\n');
		expect(await editor.page.evaluate(() => (window as any).__test.parseConverged())).toBe(true);
	});

	test('real click + End + Enter — typing lands in the empty block below', async () => {
		await editor.loadContent('Title\n=====\n');
		await editor.clickBlock(0);
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);

		expect(await editor.bridge.getBlockKind(0)).toBe('setextHeading');
		await editor.typeSlowly('X');
		await editor.bridge.waitForSourceEquals('Title\n=====\nX\n');
	});
});
