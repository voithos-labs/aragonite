import { test, expect } from '../../../../fixtures';
import { EditorPage, BLOCK_CONTENT_SELECTOR } from '../../../../editor-page';

test.describe('task checkbox — selection crossing ambient region', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace with selection extending into ambient checkbox region deletes text', async () => {
		await editor.loadContent('- [ ] pending\n');

		// Simulate the mouse-drag repro: Range.setStart inside the contenteditable="false" checkbox
		// text, setEnd at the end of "pending". Chromium permits that forward range (rooted in a
		// non-editable island); it is the DELETE it then refuses silently without the fix.
		const selState = await editor.page.evaluate((contentSelector) => {
			const wrapper = document.querySelector(`[data-block-path='[0,0,0]']`);
			const paragraph = wrapper?.querySelector(contentSelector) as HTMLElement | null;
			const checkbox = paragraph?.querySelector('.task-checkbox') as HTMLElement | null;
			if (!paragraph || !checkbox) throw new Error('structure not found');
			paragraph.focus();
			const textNode = Array.from(paragraph.childNodes).find(
				(n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes('pending')
			) as Text | undefined;
			const innerText = checkbox.firstChild as Text | null;
			if (!textNode || !innerText) throw new Error('nodes not found');
			const range = document.createRange();
			range.setStart(innerText, 1);
			range.setEnd(textNode, textNode.textContent?.length ?? 0);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
			return { collapsed: sel.isCollapsed };
		}, BLOCK_CONTENT_SELECTOR);
		expect(selState.collapsed).toBe(false);

		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForFunction(
			() => !((window as any).__test.getSource() as string).includes('pending'),
			undefined,
			{ timeout: 5000 }
		);
		// The raw-offset range clamps the ambient-crossing endpoint to raw 0,
		// so the delete removes the full content "pending". Marker survives.
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ]');
	});

	test('Delete with selection extending into ambient checkbox region deletes text', async () => {
		await editor.loadContent('- [ ] pending\n');

		const selState = await editor.page.evaluate((contentSelector) => {
			const wrapper = document.querySelector(`[data-block-path='[0,0,0]']`);
			const paragraph = wrapper?.querySelector(contentSelector) as HTMLElement | null;
			const checkbox = paragraph?.querySelector('.task-checkbox') as HTMLElement | null;
			if (!paragraph || !checkbox) throw new Error('structure not found');
			paragraph.focus();
			const textNode = Array.from(paragraph.childNodes).find(
				(n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes('pending')
			) as Text | undefined;
			const innerText = checkbox.firstChild as Text | null;
			if (!textNode || !innerText) throw new Error('nodes not found');
			const range = document.createRange();
			range.setStart(innerText, 1);
			range.setEnd(textNode, textNode.textContent?.length ?? 0);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
			return { collapsed: sel.isCollapsed };
		}, BLOCK_CONTENT_SELECTOR);
		expect(selState.collapsed).toBe(false);

		await editor.page.keyboard.press('Delete');
		await editor.page.waitForFunction(
			() => !((window as any).__test.getSource() as string).includes('pending'),
			undefined,
			{ timeout: 5000 }
		);
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ]');
	});

	test('Backspace with selection entirely within editable content still uses native (control)', async () => {
		await editor.loadContent('- [ ] pending\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Backspace');
		await editor.page.waitForFunction(
			() => !((window as any).__test.getSource() as string).includes('pending')
		);
		expect((await editor.bridge.getSource()).trim()).toBe('- [ ]');
	});
});
